# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-25

First public release.

### Added
- Chrome side panel (Manifest V3) for loading a CSV, validating it, previewing rows and running it.
- App Store Connect automation through your logged-in session:
  - creates an app when its bundle ID is not found, otherwise updates it;
  - per-locale name, subtitle, description, keywords, promotional text, what's new and URLs;
  - copyright, primary and secondary category, version creation;
  - App Review information: contact details, demo account and notes.
- Dry run mode (on by default) that only reads and lists planned changes.
- Only changed fields are sent; failures are reported per step without stopping the rest of the app.
- CSV validation: required columns, Apple's length limits, duplicate locales, email and phone checks, Excel `;` delimiter.
- Google Play tab as a placeholder (coming soon).

[0.1.0]: https://github.com/shahsawoodshinwari/launchsheet/releases/tag/v0.1.0
