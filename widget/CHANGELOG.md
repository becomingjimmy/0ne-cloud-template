# Changelog

All notable changes to SheetWidget will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-03-23

### Changed

- Switched data source from Google Sheets to 0ne Cloud API
- Widget now shows personal finance KPIs: Cash On Hand, Burn Rate, Runway (Days/Months)
- Added Bearer token authentication (WIDGET_API_KEY)
- Moved into 0ne-cloud monorepo (was standalone project)

### Removed

- Google Sheets integration (replaced by 0ne Cloud API)
- SHEET_ID / METRICS array configuration (replaced by API-driven metrics)

---

## [1.0.0] - 2026-02-03

### Added

- Initial release
- Fetch data from any public Google Sheet
- Support for unlimited metrics (no paywall!)
- Lock screen widget support (iOS 16+)
  - `accessoryRectangular` - primary format
  - `accessoryCircular` - single value
  - `accessoryInline` - text row
- Home screen widget support
  - Small, medium, and large sizes
  - Automatic layout adaptation
- Configurable styling
  - Custom colors (background, labels, values)
  - Custom fonts and sizes
  - Optional dashboard title
- Parallel data fetching for multiple metrics
- Error handling with fallback display
- In-app preview mode for testing

### Technical Details

- Uses Google Sheets CSV export endpoint (no API key required)
- Sheet must be published to web (public)
- Built for Scriptable app on iOS
- Zero external dependencies
