# Local authenticated chat reliability

This profile runs the real Next.js login, Server Actions, chat/Stop routes, GoTrue,
PostgREST, PostgreSQL migrations and owner RLS. Only the AI provider protocol is
simulated. It cannot establish hosted Preview behavior, real provider output,
pricing, timeout limits, or answer quality.

Requirements: Node.js 22, installed npm dependencies, Playwright Chromium,
OpenSSL, and Docker Compose with a local `/var/run/docker.sock` daemon. Ports
3100, 54621, 54622, 54625, 54626 and 54627 must be free. A remote Docker context
is deliberately ignored. Missing tooling blocks this profile only.

Prepare the three immutable images once (no application credentials needed):

```sh
node scripts/reliability-local/pull-images.mjs
```

Run from the repository root:

```sh
npm run test:chat:local -- --reporter=line
```

The runner checks installed tooling rather than installing dependencies. It
requires already cached images, generates disposable credentials in a private
temporary directory, creates a unique Compose project, and migrates only its
new loopback database. It clears inherited provider/database/E2E credentials;
the Playwright profile overrides application targets with the local fixture.
Never provide a production database URL or reset flag to this command.

Playwright starts and stops the auth/REST proxy, HTTPS provider simulator and
application at `http://localhost:3100`. TLS verification remains enabled; trust
extends the inherited CA bundle with a disposable localhost certificate. The
provider never forwards requests upstream. Simulated credit charges exercise
the existing product rules, and are separate from actual provider spend.

The matrix covers Fast/Balanced/High on desktop/mobile, Stop acknowledgement,
exact partial persistence and refresh, repeated Stop, provider transport abort,
Retry, immediate Retry followed by Send, native empty-chat navigation, two-tab
observation/retry, abnormal finish, dropped connection, HTTP 503, duplicate
message prevention, credits, and anonymous RLS denial. Existing unit/DB tests
cover additional quota, timeout, owner and late-completion contracts.

Each run removes only containers/volumes from its newly generated project and
deletes fixture credentials, even after ordinary test/setup failure. Existing
containers are recorded before startup and excluded from cleanup. SIGKILL or
host loss can interrupt cleanup; verify the generated project's ownership
before manually removing its resources. Never prune shared Docker storage.

Authenticated traces are disabled, and known fixture credentials are redacted
from subprocess output. Keep ignored test artifacts local: they can contain
the disposable account's DOM. CI runs the profile without hosted credentials.
