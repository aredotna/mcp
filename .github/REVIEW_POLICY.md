# Pull request review policy

The required `External contributor review` status passes automatically when GitHub identifies the PR author as an organization member or owner. Other authors, including outside collaborators, need one approval from someone with write access. Self-approval does not count, dismissed approvals stop counting, and outstanding changes requested by a reviewer with write access block the check.

Approvals remain valid after new commits, matching the repository's existing review policy. CI remains a separate required check.

`Review policy` evaluates PR openings and updates using code from the default branch. `PR review events` signals review submissions, edits, and dismissals; the privileged evaluator then reads fresh PR and review data from GitHub. It does not execute PR code or use artifacts from the signal workflow. Failed API requests produce an error status.

To recheck after changing organization membership or repository permissions, run **Actions → Review policy → Run workflow**. Leave the PR number empty to recheck every open PR. Existing open PRs also need a recheck when this policy is first installed.

Run the policy tests with:

```sh
node --test .github/scripts/review-policy.test.cjs
```
