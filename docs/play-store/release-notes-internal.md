# Internal Testing Release Notes — KitaMo 1.0.0 (versionCode 2)

Prepared for release name `1.0.0 (2) - pilot`; not yet entered in Play Console.

## What this is

First internal-testing build of KitaMo — a **local-first** selling and profit tracker for Filipino small sellers. All data stays on the tester's device: no account, no cloud, no ads, no analytics.

## What's included

- Fresh vs Demo first launch; owner/business/stall setup
- Inventory with low-stock alerts and Notify Owner
- Kiosk selling: favorites, recent products, category/search filters, quick quantity controls, cash/GCash/Maya/bank references, bundle pricing, discounts, text receipts, orders, and shift summary
- Retry-safe checkout: duplicate taps or a repeated checkout token return one sale and one receipt
- Grocery Pool: purchases per brand/source with cost per unit and low-stock badges
- Recipes: selected-lot costing, custom cost lines, cost per piece, makeable quantity, bottleneck ingredient
- Production per stall with automatic ingredient deduction and batch costing
- Cook-upon-order items: costed at sale time, never blocked by missing stock (estimated cost is flagged)
- Transfers between stalls, spoilage with loss value
- Fixed costs (rent, sweldo, bills) with due/overdue tracking and mark-paid
- Profit Reports: per-stall and consolidated (revenue, puhunan, fixed costs, sayang, net profit) across today/week/month/all
- Local Helper (answers from on-device records only), Records, Insights, in-app Pilot Guide
- Optional local Owner PIN and Android fingerprint/face confirmation for shared phones
- Android backup disabled; in-app confirmed full local reset

## What testers should focus on

1. Real-phone usability: safe areas, bottom navigation, keyboard behavior, long forms.
2. Money math: do receipt totals, bundle prices, COGS, and report numbers match your expectations?
3. The full flow: groceries → recipe → production → sale → reports.
4. Anything confusing in the Taglish copy.

## Known limitations (by design in this pilot)

No cloud backup/sync (uninstall = data loss), no login, no AI (Helper is local-only), no camera/OCR, no Bluetooth printing, no BIR/official-receipt compliance, no payment processing.

## Reporting issues

Use the format in `internal-tester-guide.md`: phone model, Android version, screen, steps, expected vs actual, screenshot.
