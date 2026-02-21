# AI Assistant Guidelines for git-on-cloudflare

This document provides comprehensive guidelines for AI assistants working on this project.

## Project Overview

**git-on-cloudflare** is a complete Git Smart HTTP v2 server running entirely on Cloudflare Workers. It implements the Git protocol with full pack support, providing a modern web UI for browsing repositories.

### Key Technologies
- **Runtime**: Cloudflare Workers (V8 isolates, no containers/VMs)
- **Storage**: Hybrid Durable Objects (DO) + R2 + Workers KV
- **Language**: TypeScript
- **Routing**: itty-router (v5)
- **Git Implementation**: isomorphic-git
- **Database**: drizzle-orm with Durable Objects SQLite
- **Templates**: LiquidJS
- **Styling**: Tailwind CSS v4
- **Package Manager**: Bun (not npm)
- **Development Environment**: mise

### Architecture at a Glance
- **Durable Objects** provide strong consistency for refs/HEAD and metadata
- **R2** provides cheap, scalable storage for pack files and loose objects
- **Workers KV** stores owner registry (owner → repos mapping)
- **SQLite in DO** enables indexed metadata queries (pack membership, hydration tracking)
- **Two-tier caching**: UI responses (60s-1hr) + immutable Git objects (1 year)

## Critical Architectural Decisions

### 1. Hybrid Storage Model (DO + R2)
- **Durable Objects**: Per-repo authority for refs, HEAD, loose objects, and SQLite metadata
- **R2**: Long-term storage for pack files (`.pack` + `.idx`) and mirrored loose objects
- **Key Pattern**: Objects stored under `do/<do-id>/objects/...` prefix in R2
- **Why**: DO provides consistency for writes; R2 provides cheap storage with range-read support

See `docs/storage.md` for full details.

### 2. SQLite Data Access Layer (DAL)
- **Location**: `src/do/repo/db/dal.ts`
- **Rule**: ALL SQLite operations MUST go through the DAL
- **Tables**:
  - `pack_objects(pack_key, oid)` - Pack membership (indexed by oid)
  - `hydr_cover(work_id, oid)` - Hydration coverage sets
  - `hydr_pending(work_id, kind, oid)` - Pending hydration work
- **Migrations**: Run on DO initialization via `migrate(db, migrations)`
- **Why**: Centralized access prevents raw drizzle queries and maintains consistency

### 3. Time-Budgeted Background Unpacking
- **Problem**: Workers have 30s CPU limit per request
- **Solution**: Push flow writes raw `.pack` to R2, creates fast `.idx`, queues unpack for background processing
- **Mechanism**: DO alarm processes unpack in small chunks (controlled by env vars)
- **Queue**: At most 2 concurrent pushes (one active + one-deep next slot)
- **Preflight**: Worker checks `getUnpackProgress()` RPC and returns 503 if queue is full

### 4. Pack Discovery and Memoization
- **Location**: `src/git/operations/packDiscovery.ts#getPackCandidates()`
- **Strategy**: Coalesce per-request discovery using DO metadata + best-effort R2 listing
- **Caching**: Results memoized in `RequestMemo` to avoid redundant calls
- **Why**: Reduces DO/R2 calls and respects platform subrequest limits

### 5. Static Assets via Wrangler Assets Binding
- **Binding**: `env.ASSETS` serves files from `src/assets/`
- **Templates**: LiquidJS loads templates via custom FS adapter that fetches through `env.ASSETS`
- **Important**: `html_handling: "none"` prevents assets layer from intercepting routes like `/auth`
- **Streaming**: Uses Node `Readable.toWeb()` to convert LiquidJS streams to Web ReadableStream

## Development Workflow

### Environment Setup
This project uses **mise** for development environment management (NOT npm scripts directly).

```bash
# Install mise (if not already installed)
# See https://mise.jdx.dev/getting-started.html

# Install dependencies
mise run install  # or: bun install

# Verify mise setup
mise doctor
```

### Common Tasks (via mise)

```bash
# Development server (local mode, no Docker required)
mise run dev

# Build CSS (required before first run)
mise run build:css

# Watch CSS during active UI work
mise run watch:css

# Run all tests
mise run test           # AVA tests (legacy)
mise run test:workers   # Vitest tests (Worker environment)
mise run test:auth      # Vitest auth tests

# Type checking
mise run typecheck

# Code formatting
mise run format         # Format code
mise run format:check   # Check formatting

# Generate Cloudflare types
mise run cf-typegen

# Generate database migrations
mise run db:gen

# Deploy to production
mise run deploy  # Builds CSS and deploys to Cloudflare
```

### Available mise Tasks
See `mise.toml` for the complete list. All tasks wrap bun commands.

## Testing Approach

### Test Suites
1. **Vitest Tests** (Recommended): `test/**/*.worker.test.ts`
   - Run in Worker environment using `@cloudflare/vitest-pool-workers`
   - Full integration tests with Durable Objects, R2, KV
   - Command: `mise run test:workers`
   - Config: `vitest.config.ts` (workers), `vitest.auth.config.ts` (auth)

2. **AVA Tests** (Legacy): `test/**/*.test.ts` (excluding `.worker.test.ts`)
   - Unit tests not requiring Worker environment
   - Command: `mise run test`
   - Config: `package.json` ava section
   - Note: Some AVA tests may be flaky or outdated

### Testing Best Practices
- **Prefer Vitest** for new tests (Worker environment is more realistic)
- **Windows workaround**: `singleWorker: true` and `isolatedStorage: false` to avoid EBUSY errors
- **No persistence**: Tests use in-memory storage (`durableObjectsPersist: false`)
- **Auth disabled**: Tests use empty `AUTH_ADMIN_TOKEN`

### Known Test Issues
- Some AVA tests may fail due to environment differences (use Vitest instead)
- Windows: File locking issues with SQLite (addressed in vitest config)

## Code Style and Conventions

### TypeScript
- Strict mode enabled
- Use explicit types for public APIs
- Prefer interfaces over type aliases for object shapes
- No `any` types (use `unknown` if needed)

### Module Organization
All modules use `index.ts` for exports:
```typescript
// Bad: import { foo } from './module/foo'
// Good: import { foo } from './module'
```

### Module Structure
```
/git          - Core Git functionality (operations, pack, protocol)
/do           - Durable Objects (repo, auth)
/auth         - Authentication module
/cache        - Two-tier caching system
/web          - Web UI (format, render, templates)
/common       - Shared utilities
/registry     - Owner/repo registry
/routes       - HTTP route handlers
```

### Naming Conventions
- **Files**: kebab-case (`repo-do.ts`, `pack-discovery.ts`)
- **Classes**: PascalCase (`RepoDurableObject`, `AuthDurableObject`)
- **Functions**: camelCase (`getPackCandidates`, `listRefs`)
- **Constants**: UPPER_SNAKE_CASE (`LOG_LEVEL`, `REPO_KEEP_PACKS`)

### Import Aliases
- `@/` maps to `./src/` (configured in vitest and tsconfig)

### Logging
Use structured JSON logging:
```typescript
import { createLogger } from '@/common/logger';

const log = createLogger('module-name');
log.debug('Debug message', { context });
log.info('Info message', { context });
log.warn('Warning message', { context });
log.error('Error message', { error, context });
```

Control verbosity with `LOG_LEVEL` env var (debug|info|warn|error).

## Deployment Process

### Prerequisites
```bash
# Login to Cloudflare
wrangler login

# Set admin token (required for auth UI)
wrangler secret put AUTH_ADMIN_TOKEN
```

### Deployment Commands
```bash
# Deploy to production
mise run deploy  # Builds CSS + deploys

# Manual deployment
bun run build:css
wrangler deploy
```

### Configuration
- **Deployment config**: `wrangler.jsonc`
- **Routes**: Configured in `wrangler.jsonc` routes section
- **Environment variables**: Set via `wrangler secret put` or `vars` section
- **Bindings**: Durable Objects, R2, KV, Assets

### Important Deployment Notes
- CSS must be built before deployment (`build:css`)
- Secrets (like `AUTH_ADMIN_TOKEN`) are not in git
- Durable Objects use migrations (`migrations` in wrangler.jsonc)
- Assets are served from `src/assets/` via Wrangler assets binding

## Important Gotchas and Known Issues

### 1. AVA Tests May Fail
- **Symptom**: Some AVA tests fail in certain environments
- **Cause**: Environment differences, outdated test setup
- **Solution**: Prefer Vitest tests (`mise run test:workers`) which run in actual Worker environment

### 2. Windows File Locking
- **Symptom**: EBUSY errors during test teardown on Windows
- **Cause**: SQLite file locking
- **Solution**: Already addressed in `vitest.config.ts` with `singleWorker: true` and `isolatedStorage: false`

### 3. CSS Must Be Built
- **Symptom**: Styles missing or broken in development
- **Cause**: Tailwind CSS v4 requires build step
- **Solution**: Run `mise run build:css` before first dev session
- **Tip**: Use `mise run watch:css` during active UI work

### 4. Pack Size Limits
- **Limit**: ~100-128MB pack files (buffered in DO memory)
- **Cause**: Receive-pack buffers uploaded pack in Durable Object
- **Solution**: Split large pushes into smaller chunks if needed

### 5. Auth Token Hashing
- **Method**: PBKDF2-SHA256 with 100k iterations
- **Performance**: Token verification is CPU-intensive
- **Implication**: Keep auth checks efficient, cache results when possible

### 6. Liquid Template Escaping
- **Default**: `{{ var }}` is HTML-escaped (`outputEscape: "escape"`)
- **Raw output**: Use `{{ var | raw }}` for HTML content
- **Why**: Prevent XSS by default

### 7. R2 Listing Caveats
- **Limit**: R2 list operations return max 1000 objects per call
- **Strategy**: Pack discovery uses "best-effort" R2 listing + DO metadata
- **Implication**: Very large repos (>1000 packs) may need pagination

### 8. Do Not Use npm
- **Package manager**: Bun (not npm)
- **Lock file**: `bun.lock` (NOT `package-lock.json`)
- **Commands**: Use `bun install`, `bun run`, etc.
- **Why**: Project migrated to bun for performance

### 9. Durable Objects SQLite Access
- **Rule**: ALL SQLite queries MUST go through DAL (`src/do/repo/db/dal.ts`)
- **Why**: Maintains consistency, prevents raw drizzle anti-patterns
- **Enforcement**: Code review, linting (future)

### 10. Assets Binding and Routes
- **Config**: `html_handling: "none"` in `wrangler.jsonc`
- **Why**: Prevents assets layer from mapping `/auth` → `auth.html`
- **Implication**: Worker must handle all routes explicitly

## Key Files to Understand

### Core Worker
- `src/index.ts` - Main Worker entry point, route setup
- `wrangler.jsonc` - Cloudflare configuration (bindings, env vars, migrations)

### Durable Objects
- `src/do/repo/repoDO.ts` - Repository Durable Object (refs, objects, SQLite)
- `src/do/auth/authDO.ts` - Auth Durable Object (token management)
- `src/do/repo/db/dal.ts` - SQLite data access layer

### Git Protocol
- `src/git/operations/upload-pack.ts` - Fetch/clone operations
- `src/git/operations/receive-pack.ts` - Push operations
- `src/git/pack/` - Pack assembly, indexing, unpacking
- `src/git/operations/packDiscovery.ts` - Pack candidate discovery

### Routes
- `src/routes/git.ts` - Git protocol endpoints
- `src/routes/ui.ts` - Web UI routes
- `src/routes/auth.ts` - Authentication UI/API
- `src/routes/admin.ts` - Admin routes

### Configuration
- `mise.toml` - Development task definitions
- `package.json` - Dependencies and scripts (via bun)
- `drizzle.config.ts` - Database migration config
- `vitest.config.ts` - Worker test configuration

## Documentation References

Comprehensive documentation is available in `docs/`:
- [API Endpoints](docs/api-endpoints.md) - Complete HTTP API reference
- [Architecture Overview](docs/architecture.md) - Module structure and components
- [Storage Model](docs/storage.md) - Hybrid DO + R2 storage design
- [Data Flows](docs/data-flows.md) - Push, fetch, and web UI flows
- [Caching Strategy](docs/caching.md) - Two-tier caching implementation

Always reference these docs when working on related features.

## Making Changes

### Before You Start
1. Read relevant documentation in `docs/`
2. Understand the module structure
3. Check for existing tests
4. Verify mise environment: `mise doctor`

### Development Workflow
1. Create a feature branch
2. Make minimal, focused changes
3. Follow existing patterns and conventions
4. Add/update tests (prefer Vitest)
5. Run type checking: `mise run typecheck`
6. Run tests: `mise run test:workers`
7. Format code: `mise run format`
8. Test locally: `mise run dev`
9. Build CSS if needed: `mise run build:css`

### Commit Messages
- Use conventional commits format (optional but helpful)
- Be descriptive and reference issues if applicable
- Example: `feat: add pack size validation in receive-pack`

### Before Deployment
1. All tests pass (`mise run test:workers`, `mise run typecheck`)
2. Code is formatted (`mise run format:check`)
3. CSS is built (`mise run build:css`)
4. Test locally (`mise run dev`)
5. Review changes for security implications

## Common Tasks for AI Assistants

### Adding a New Route
1. Define handler in `src/routes/` (git, ui, auth, or admin)
2. Register route in `src/index.ts`
3. Add tests in `test/` (prefer `.worker.test.ts`)
4. Update `docs/api-endpoints.md` if needed

### Modifying Durable Object
1. Add RPC method or modify existing in `src/do/repo/repoDO.ts` or `authDO.ts`
2. If touching SQLite, update DAL in `src/do/repo/db/dal.ts`
3. Add migration if schema changes (use `mise run db:gen`)
4. Update migration tag in `wrangler.jsonc` if needed
5. Test with Vitest worker tests

### Working with Pack Files
1. Pack assembly: `src/git/pack/assembler.ts`
2. Pack indexing: `src/git/pack/indexer.ts`
3. Pack unpacking: `src/do/repo/handlers/unpack.ts`
4. Pack discovery: `src/git/operations/packDiscovery.ts`
5. Always test with real Git clients (clone, fetch, push)

### Updating Templates
1. Templates in `src/assets/templates/`
2. Partials in `src/assets/templates/partials/`
3. Remember: `{{ var }}` is HTML-escaped by default
4. Test rendering in browser (`mise run dev`)
5. Rebuild CSS if styles changed (`mise run build:css`)

### Adding Environment Variables
1. Add to `wrangler.jsonc` vars section (for text/JSON)
2. Use `wrangler secret put` for sensitive values
3. Add TypeScript types in `worker-configuration.d.ts` (if exists)
4. Document in README or relevant docs

## Security Considerations

### Authentication
- Auth is OPTIONAL (disabled by default)
- When enabled (`AUTH_ADMIN_TOKEN` set), pushes require per-owner tokens
- Tokens use PBKDF2-SHA256 with 100k iterations
- Reads are always public

### Input Validation
- Validate all user input (repo names, refs, etc.)
- Sanitize before rendering in templates (Liquid auto-escapes by default)
- Check pack sizes to prevent DoS

### Secrets Management
- NEVER commit secrets to git
- Use `wrangler secret put` for production secrets
- Use `.dev.vars` for local development secrets (gitignored)

### XSS Prevention
- Liquid templates auto-escape by default (`outputEscape: "escape"`)
- Only use `| raw` filter when absolutely necessary
- Sanitize user-generated content (repo names, commit messages)

## Performance Considerations

### Caching
- UI responses: 60s (HEAD/refs), 5min (README), 1hr (tag commits)
- Git objects: 1 year (immutable)
- Pack discovery: Per-request memoization

### DO Subrequest Limits
- Workers have subrequest limits (50 per request by default)
- Use `RequestMemo` and `Limiter` to manage DO/R2 calls
- Batch operations when possible (e.g., `getPackOidsBatch`)

### CPU Limits
- 30s CPU limit per request
- Background work (unpack) runs in alarm-driven slices
- Time-budgeted unpacking controlled by env vars

### Memory
- Receive-pack buffers pack in memory (~100-128MB practical limit)
- Streaming pack assembly from R2 to avoid buffering
- Use `crypto.DigestStream` for incremental SHA-1 computation

## Questions or Issues?

### Documentation
1. Check `docs/` for detailed documentation
2. Review this file (AGENTS.md)
3. Read relevant source files (code is well-commented)

### Testing
1. Run tests to verify behavior: `mise run test:workers`
2. Test locally: `mise run dev`
3. Check Vitest worker tests for examples

### Debugging
1. Use `LOG_LEVEL=debug` for verbose logging
2. Check Cloudflare dashboard for production logs
3. Use Wrangler tail for live log streaming: `wrangler tail`

### Changes
1. Keep changes minimal and focused
2. Follow existing patterns
3. Add tests for new functionality
4. Update documentation as needed

---

**Last Updated**: 2026-02-21
**Project Version**: 0.1.0
