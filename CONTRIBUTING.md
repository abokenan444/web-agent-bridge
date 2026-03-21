# Contributing to Web Agent Bridge

Thank you for your interest in contributing to Web Agent Bridge! This project aims to create a standardized interface for AI agents to interact with websites safely and efficiently.

## How to Contribute

### Reporting Bugs

- Open an [issue](../../issues) with a clear title and description
- Include steps to reproduce the bug
- Add browser/OS/Node.js version details
- Include error messages or screenshots if applicable

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the feature and its use case
- Explain how it would benefit AI agent interactions

### Pull Requests

1. **Fork** the repository
2. **Create a branch** for your feature: `git checkout -b feature/my-feature`
3. **Make your changes** and test them
4. **Commit** with clear messages: `git commit -m "Add: description of change"`
5. **Push** to your fork: `git push origin feature/my-feature`
6. **Open a Pull Request** against the `main` branch

### Development Setup

```bash
# Clone the repo
git clone https://github.com/abokenan444/web-agent-bridge.git
cd web-agent-bridge

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Start development server
npm start
```

The server runs on `http://localhost:3000`.

### Project Structure

```
server/          → Express.js backend (API, auth, licensing)
script/          → Bridge script (ai-agent-bridge.js) — the core product
public/          → Frontend (landing page, dashboard, docs)
scripts/         → Build tools
```

### Code Guidelines

- Follow existing code style and patterns
- Keep functions small and focused
- Add comments for complex logic only
- Test your changes before submitting
- Ensure no security vulnerabilities are introduced

### Commit Message Format

```
Add: new feature description
Fix: bug description
Update: what was changed
Remove: what was removed
Docs: documentation changes
```

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help newcomers feel welcome

## Questions?

Open an issue or start a discussion. We're happy to help!

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
