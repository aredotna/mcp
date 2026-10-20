const STATUS_CONTEXT = "External contributor review";

async function reviewDecision({ pull, reviews, canReview }) {
  if (["MEMBER", "OWNER"].includes(pull.author_association)) {
    return {
      state: "success",
      description: "Organization member: no approval required.",
    };
  }

  const latest = new Map();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (!review.user || review.user.id === pull.user.id) continue;
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
      latest.set(review.user.login, review.state);
    }
  }

  let approvals = 0;
  for (const [login, state] of latest) {
    if (state === "DISMISSED" || !(await canReview(login))) continue;
    if (state === "CHANGES_REQUESTED") {
      return {
        state: "failure",
        description: "A reviewer with write access has requested changes.",
      };
    }
    if (state === "APPROVED") approvals += 1;
  }

  return approvals > 0
    ? {
        state: "success",
        description: "Non-member PR approved by a reviewer with write access.",
      }
    : {
        state: "failure",
        description:
          "Non-member PR needs one approval from a reviewer with write access.",
      };
}

async function run({ github, context, core }) {
  const repo = context.repo;
  const defaultBranch = context.payload.repository.default_branch;
  const requested =
    context.payload.pull_request?.number ??
    context.payload.inputs?.pull_request_number;
  const pulls = requested
    ? [
        (
          await github.rest.pulls.get({
            ...repo,
            pull_number: Number(requested),
          })
        ).data,
      ]
    : await github.paginate(github.rest.pulls.list, {
        ...repo,
        state: "open",
        base: defaultBranch,
        per_page: 100,
      });
  let failed = false;

  for (const pull of pulls) {
    if (pull.state !== "open" || pull.base.ref !== defaultBranch) continue;
    const status = {
      ...repo,
      sha: pull.head.sha,
      context: STATUS_CONTEXT,
      target_url: `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`,
    };
    try {
      await github.rest.repos.createCommitStatus({
        ...status,
        state: "pending",
        description: "Checking author membership and maintainer reviews.",
      });
      const reviews = ["MEMBER", "OWNER"].includes(pull.author_association)
        ? []
        : await github.paginate(github.rest.pulls.listReviews, {
            ...repo,
            pull_number: pull.number,
            per_page: 100,
          });
      const decision = await reviewDecision({
        pull,
        reviews,
        canReview: async (username) => {
          try {
            const { data } =
              await github.rest.repos.getCollaboratorPermissionLevel({
                ...repo,
                username,
              });
            return (
              data.user?.permissions?.push === true ||
              ["admin", "write", "maintain"].includes(data.permission)
            );
          } catch (error) {
            if (error.status === 404) return false;
            throw error;
          }
        },
      });
      await github.rest.repos.createCommitStatus({ ...status, ...decision });
      core.info(`#${pull.number}: ${decision.description}`);
    } catch (error) {
      failed = true;
      core.error(`Could not evaluate #${pull.number}: ${error.message}`);
      await github.rest.repos.createCommitStatus({
        ...status,
        state: "error",
        description:
          "Review policy could not be evaluated; rerun the workflow.",
      });
    }
  }
  if (failed)
    core.setFailed("One or more review checks could not be evaluated.");
}

module.exports = { reviewDecision, run };
