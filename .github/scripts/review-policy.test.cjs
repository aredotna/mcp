const assert = require("node:assert/strict");
const { test } = require("node:test");
const { reviewDecision, run } = require("./review-policy.cjs");

const pull = {
  number: 6,
  state: "open",
  base: { ref: "main" },
  head: { sha: "head" },
  author_association: "CONTRIBUTOR",
  user: { id: 1 },
};
const review = (id, state, login = "maintainer", userId = 2) => ({
  id,
  state,
  user: { login, id: userId },
});
const decide = (
  reviews = [],
  association = "CONTRIBUTOR",
  canReview = async () => true,
) =>
  reviewDecision({
    pull: { ...pull, author_association: association },
    reviews,
    canReview,
  });

test("members and owners need no approval", async () => {
  for (const association of ["MEMBER", "OWNER"])
    assert.equal((await decide([], association)).state, "success");
});

test("non-members and outside collaborators require approval", async () => {
  for (const association of [
    "NONE",
    "CONTRIBUTOR",
    "FIRST_TIMER",
    "FIRST_TIME_CONTRIBUTOR",
    "COLLABORATOR",
  ]) {
    assert.equal((await decide([], association)).state, "failure");
  }
});

test("only a reviewer with write access can satisfy the gate", async () => {
  assert.equal((await decide([review(1, "APPROVED")])).state, "success");
  assert.equal(
    (await decide([review(1, "APPROVED")], "CONTRIBUTOR", async () => false))
      .state,
    "failure",
  );
});

test("self-approval does not count", async () => {
  assert.equal(
    (await decide([review(1, "APPROVED", "author", 1)])).state,
    "failure",
  );
});

test("dismissed approvals stop counting even when reviews are out of order", async () => {
  assert.equal(
    (await decide([review(2, "DISMISSED"), review(1, "APPROVED")])).state,
    "failure",
  );
});

test("comments do not revoke an existing approval", async () => {
  assert.equal(
    (await decide([review(1, "APPROVED"), review(2, "COMMENTED")])).state,
    "success",
  );
});

test("outstanding change requests block outsiders until the reviewer approves", async () => {
  const reviews = [
    review(1, "APPROVED"),
    review(2, "CHANGES_REQUESTED", "other", 3),
  ];
  assert.equal((await decide(reviews)).state, "failure");
  assert.equal(
    (await decide([...reviews, review(3, "APPROVED", "other", 3)])).state,
    "success",
  );
});

test("an API failure leaves an error status, never success", async () => {
  const statuses = [];
  let failed = false;
  const github = {
    rest: {
      pulls: { get: async () => ({ data: pull }), listReviews: () => {} },
      repos: { createCommitStatus: async (status) => statuses.push(status) },
    },
    paginate: async () => {
      throw new Error("API unavailable");
    },
  };
  await run({
    github,
    context: {
      repo: { owner: "aredotna", repo: "mcp" },
      payload: {
        repository: { default_branch: "main" },
        pull_request: { number: 6 },
      },
      serverUrl: "https://github.com",
      runId: 1,
    },
    core: {
      info() {},
      error() {},
      setFailed() {
        failed = true;
      },
    },
  });
  assert.deepEqual(
    statuses.map((s) => s.state),
    ["pending", "error"],
  );
  assert.ok(statuses.every((s) => s.sha === "head"));
  assert.equal(failed, true);
});
