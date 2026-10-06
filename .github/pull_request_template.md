## Summary

<!-- What changed and why? Keep the PR focused on one logical change. -->

## Type

- [ ] Feature (`feat/*`)
- [ ] Fix (`fix/*` or `hotfix/*`)
- [ ] Refactor / performance
- [ ] Tests / docs / chore
- [ ] Release (`release/*` → `main`)

## Target

- [ ] `main`
- [ ] Active `release/*` branch

## Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run release:check`
- [ ] Relevant integration/E2E checks completed, or not applicable

## Preview

Vercel Preview: <!-- paste preview URL when available -->

Smoke-tested flows:

- <!-- flow/result -->

## Release / migration impact

- Database migration: none / describe
- Environment variables: none / describe
- User-facing changelog: not needed / updated
- Rollback concern: none / describe

## Merge checklist

- [ ] PR Guard is green
- [ ] Vercel Preview build is ready
- [ ] Changed runtime/UI behavior was smoke-tested on Preview
- [ ] No unrelated changes are included
- [ ] Ready for **Squash and merge**
- [ ] Delete source branch after merge
