# Contributing to Web Agent Bridge (WAB)

First off, thank you for considering contributing to Web Agent Bridge! It's people like you that make WAB such a great tool for the community. This project aims to create a standardized interface for AI agents to interact with websites safely and efficiently.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct. Please treat everyone with respect and kindness. Focus on constructive feedback and help newcomers feel welcome.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for WAB. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

- **Check existing issues:** Before creating a new issue, please check if it has already been reported.
- **Use the Bug Report template:** When you create an issue, please use the provided template in `.github/ISSUE_TEMPLATE/` and fill out all the required information.
- **Provide context:** Include details about your environment (OS, Node.js version, browser) and steps to reproduce the bug.
- **Include error messages:** Add logs or screenshots if applicable.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for WAB, including completely new features and minor improvements to existing functionality.

- **Check existing issues and discussions:** Your idea might already be planned or under discussion in our [GitHub Discussions](https://github.com/abokenan444/web-agent-bridge/discussions).
- **Use the Feature Request template:** Clearly describe the feature, the problem it solves, and how it should work.

### Pull Requests

The process described here has several goals:
- Maintain WAB's quality
- Fix problems that are important to users
- Engage the community in working toward the best possible WAB

Please follow these steps to have your contribution considered by the maintainers:

1. **Fork the repository** and create your branch from `master` (e.g., `git checkout -b feature/my-feature`).
2. **Make your changes:** Write clean, documented code.
3. **Test your changes:** Ensure your changes do not break existing functionality. Run `npm test`.
4. **Update documentation:** If you change the API or add a new feature, update the relevant `README.md` and documentation files.
5. **Commit your changes:** Use clear and descriptive commit messages (see format below).
6. **Submit a Pull Request:** Fill out the PR template and link any relevant issues.

## Development Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/abokenan444/web-agent-bridge.git
   cd web-agent-bridge
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env` file:
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   npm run dev
   # or
   npm start
   ```

The server runs on `http://localhost:3000`.

### Running Tests

```bash
npm test
```
Tests run with `NODE_ENV=test` and use a separate SQLite database (`data-test/`) to avoid touching production data.

## Project Structure

```
server/          → Express.js backend (API, auth, licensing)
  models/
    db.js        → SQLite database (default)
    adapters/    → PostgreSQL & MySQL adapters
script/          → Bridge script (ai-agent-bridge.js) — the core product
public/          → Frontend (landing page, dashboard, docs)
sdk/             → Agent SDK for building AI agents
examples/        → Ready-to-run agent examples
bin/             → CLI entry point (npx web-agent-bridge)
tests/           → Jest test suite
integrations/    → Hosting and deployment integrations
```

## Coding Standards

- Follow existing code style and patterns.
- Keep functions small and focused.
- Add comments for complex logic only.
- Ensure no security vulnerabilities are introduced.

### Commit Message Format

```
Add: new feature description
Fix: bug description
Update: what was changed
Remove: what was removed
Docs: documentation changes
```

## Open Core Model

Please note that WAB operates on an **Open Core** model. While the core protocol and many features are open-source (MIT), some advanced features and integrations may be proprietary or require a commercial license. 

When contributing, ensure your changes apply to the open-source components unless you are explicitly working on a premium feature in coordination with the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

Thank you for contributing! 🚀
