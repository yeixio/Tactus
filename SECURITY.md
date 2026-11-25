# Security policy

## Supported versions

Tactus is at an early stage. Security fixes go into the latest release and `main`.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/yeixio/Tactus/security) of the repository.
2. Choose **Report a vulnerability**.

Include what you found, how to reproduce it (a project folder or `.tac` file that triggers it helps a lot), and the impact you expect. We aim to reply within a week and will keep you updated while we work on a fix. We're happy to credit you in the release notes.

Things that are in scope include project files or `.tac` code that can read or write files outside the project, run code, or crash the app, and problems in the Electron shell such as its IPC surface.
