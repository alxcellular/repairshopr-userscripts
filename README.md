# RepairShopr userscripts

Tampermonkey scripts for ALX Cellular's RepairShopr.

## PO → Supplier Import File

[`rs-po-supplier-export.user.js`](rs-po-supplier-export.user.js) adds a green **⬇ &lt;Supplier&gt; import** button to every Purchase Order page. It downloads the PO in the cart-import format of the PO's vendor:

| Vendor in RepairShopr | File | Columns |
|---|---|---|
| Mobile Sentrix | .xlsx | `SKU`, `Qty` |
| WGP | .xlsx | `sku`, `quantity` |
| Injured Gadgets | .csv | `sku,qty` |
| Phone LCD Parts | .csv | `sku,qty` |

The click that starts the download also opens that supplier's quick-order page in a new tab, ready for the import.

**Mobile Sentrix** goes one step further: on its quick-order page the script imports the file and clicks **Add to cart** for you, then shows a green banner. If Mobile Sentrix reports an import issue (unknown SKU, restricted or out-of-stock item), it stops before adding anything and lists the issues in an orange banner. You must be logged in to Mobile Sentrix. The script never checks out. No file is downloaded for Mobile Sentrix; if the automatic import fails, a red banner offers the file to download and import by hand.

The SKU comes from the line's **Vendor SKU** only. Lines with no Vendor SKU or a zero quantity are left out and listed before downloading. Duplicate SKUs are combined.

**Install:** with Tampermonkey in Chrome, open
<https://raw.githubusercontent.com/alxcellular/repairshopr-userscripts/main/rs-po-supplier-export.user.js>
and click **Install**. Tampermonkey then checks this repo for updates by itself.

**Add a supplier:** add an entry to the `SUPPLIERS` list near the top of the script and raise `@version`.
