# CLAUDE.md - Worker WebSockets SSE Example

## Commands
- Build: `pnpm run build`
- Development: `pnpm run dev`
- Deploy: `pnpm run deploy`
- Lint: `pnpm run lint`
- Type checking: `tsc -b`

## Code Style
- Use TypeScript strict mode with complete type annotations
- Follow React functional component patterns with hooks
- Use ESM imports (project is configured as type: "module")
- Follow Prettier/ESLint defaults for formatting
- Use Cloudflare Workers/Durable Objects idioms
- Function/variable naming: camelCase, components: PascalCase
- Prefer async/await over Promise chains
- Handle all errors explicitly with try/catch
- Use explicit type annotations especially for function parameters