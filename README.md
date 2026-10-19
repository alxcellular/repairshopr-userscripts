# RepairShopr userscripts

Tampermonkey scripts for ALX Cellular's RepairShopr.

## PO → Supplier cart

[`rs-po-supplier-export.user.js`](rs-po-supplier-export.user.js) adds a green button to every Purchase Order page. What it does depends on the PO's vendor:

| Vendor in RepairShopr | Green button | Import format |
|---|---|---|
| Mobile Sentrix | 🛒 adds the items to your Mobile Sentrix cart | .xlsx `SKU`, `Qty` |
| WGP | 🛒 adds the items to your WGP cart | .xlsx `sku`, `quantity` |
| Phone LCD Parts | 🛒 adds the items to your Phone LCD Parts cart | .csv `sku,qty` |
| Injured Gadgets | ⬇ downloads the import file and opens Quick Order | .csv `sku,qty` |

For the 🛒 vendors, the click opens the vendor's quick-order page in a new tab; the script there runs the vendor's own file import and Add to cart, then shows a banner:

- **green** — everything was added
- **orange** — some lines were not added (Mobile Sentrix: nothing is added until you fix the listed issues; WGP and Phone LCD Parts: the rest was added and the skipped lines are listed)
- **red** — the import failed; the banner offers the file to import by hand

A separate **⬇ File** button next to the 🛒 button only downloads the import file. You must be logged in to the vendor site. The script never checks out.

Injured Gadgets stays download-only because Quick Order is turned off for our account there ("Quick order is not available for your account").

The SKU comes from the line's **Vendor SKU** only. Lines with no Vendor SKU or a zero quantity are left out and listed first. Duplicate SKUs are combined.

**Install:** with Tampermonkey in Chrome, open
<https://raw.githubusercontent.com/alxcellular/repairshopr-userscripts/main/rs-po-supplier-export.user.js>
and click **Install**. Tampermonkey then checks this repo for updates by itself; opening that link again updates right away.

**Add a supplier:** add an entry to the `SUPPLIERS` list near the top of the script and raise `@version`.
