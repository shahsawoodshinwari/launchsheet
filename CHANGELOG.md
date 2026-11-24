# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-25

### Fixed
- Re-opening the panel after reloading the extension could leave an older copy of the page script handling runs. The newest copy now replaces it.

### Changed
- The toolbar icon and side panel are enabled only on App Store Connect tabs, and a run acts only on the tab the panel was opened from.
- The activity log uses plain labels per step ("Store listing (en-US): up to date"), shows name changes as old to new, and ends with a per-app and overall summary.
- Applying changes is confirmed inline in the panel instead of a browser dialog.
- Categories are skipped when the app already has them.
- The CSV preview shows every value the run will use: app details (SKU, version, categories, review contact, demo account with the password masked) and, per locale, all listing fields with character counts. Empty fields are marked as left unchanged.

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

[Unreleased]: https://github.com/shahsawoodshinwari/launchsheet/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/shahsawoodshinwari/launchsheet/releases/tag/v0.1.1
[0.1.0]: https://github.com/shahsawoodshinwari/launchsheet/releases/tag/v0.1.0
