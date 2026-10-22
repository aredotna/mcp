# Pull request review policy

The required `External contributor review` status passes automatically when the PR author is an organization member or owner. Other authors, including outside collaborators, need one approval from someone with write access. Self-approvals don't count, dismissed approvals stop counting, and outstanding change requests from reviewers with write access block the check.

Approvals stay valid after new commits. CI is a separate required check.

The `Review policy` workflow runs on PR openings and updates using code from the default branch. The `PR review events` workflow signals review submissions, edits, and dismissals, and the evaluator then reads fresh PR and review data from GitHub. It never runs PR code or uses artifacts from the signal workflow. Failed API requests produce an error status.

To recheck after changing organization membership or repository permissions, run **Actions → Review policy → Run workflow**. Leave the PR number empty to recheck every open PR.

Run the policy tests with:

```sh
node --test .github/scripts/review-policy.test.cjs
```
