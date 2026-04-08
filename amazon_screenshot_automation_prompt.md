# AI Automation Prompt

## Task
Capture full-page screenshots of Amazon’s homepage and Spring Deal Days event pages across the listed marketplaces, all available language variants, and two required viewports.

## Target Marketplaces

| Domain        | Country        | Languages        |
|---------------|----------------|------------------|
| amazon.co.uk  | United Kingdom | English          |
| amazon.de     | Germany        | German / English |
| amazon.fr     | France         | French           |
| amazon.es     | Spain          | Spanish          |
| amazon.it     | Italy          | Italian          |
| amazon.com.be | Belgium        | Dutch / French   |
| amazon.nl     | Netherlands    | Dutch            |
| amazon.se     | Sweden         | Swedish          |
| amazon.pl     | Poland         | Polish           |
| amazon.ie     | Ireland        | English          |

## Pages to Capture
For each marketplace and each supported language, capture:

1. Homepage: `https://www.amazon.{domain}/`
2. Event page: `https://www.amazon.{domain}/springdealdays`

If the event URL redirects, capture the redirected destination.

## Language Handling
For each marketplace:
1. Detect available languages from the language selector.
2. Switch to each language.
3. Capture homepage + event page per language.
4. Treat each language as a separate capture set.

## Required Viewports (only these two)
- Desktop: `1920 × 1080`
- Mobile (iPhone 14 Pro): `393 × 852`

Use appropriate desktop/mobile user agents.

## Screenshot Procedure (for each marketplace × language × page × device)
1. Navigate to target URL.
2. Accept cookie banner.
3. Wait for page load completion.
4. Wait an additional 5 seconds.
5. Slowly scroll to bottom to trigger all lazy-loading.
   - Ensure deal grids and cards are loaded.
6. Scroll back to top.
7. Capture full-page screenshot.

## Blank Page Rule (critical)
If page content is missing or blank (hero, deal grids, images, modules, carousels):
1. Refresh page.
2. Repeat load + scroll sequence.
3. Retry until complete content is visible.

Screenshots must not include:
- Blank sections
- Placeholder/skeleton loaders
- Missing deal grids

## Event Page Deal Grid Requirement
On event pages:
1. Wait until deal tiles are visible.
2. Scroll until every product card is loaded.
3. Continue scrolling passes until no new products appear.
4. Ensure the entire deal grid is captured top-to-bottom.

## Naming Convention
Format:
`amazon_{market}_{language}_{page}_{device}_{resolution}_{date}.png`

Examples:
- `amazon_uk_en_home_desktop_1920x1080_2026-03-12.png`
- `amazon_de_de_event_mobile_393x852_2026-03-12.png`
- `amazon_be_fr_event_desktop_1920x1080_2026-03-12.png`

## Folder Structure
```text
/amazon-screenshots
    /UK
        /homepage
        /event
    /DE
        /homepage
        /event
    /FR
    /ES
    /IT
    /BE
    /NL
    /SE
    /PL
    /IE
```

## Metadata Logging
Record for each attempt:
- URL
- Marketplace
- Language
- Page type (homepage/event)
- Device
- Viewport
- Timestamp
- Screenshot success/failure
- Blank-page retry count

## Quality Gate
Accept a screenshot only if:
- Hero banners are fully visible.
- No cookie/login overlays block content.
- Promo modules are loaded.
- Deal grids/products are fully loaded.
- No blank/unrendered sections remain.

If any quality check fails, refresh and retry.
