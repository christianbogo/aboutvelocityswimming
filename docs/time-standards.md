# Time standards

Open Data → Standards to create or edit an edition. Enter its name, governing body, season, effective and expiration dates, and official source URL. Add cuts by course, category, age group, event, and tier. Save writes the complete edition atomically and refreshes the standard-cut projection.

All times must be positive integer milliseconds derived from an exact displayed time. Courses and events must agree; dates must be chronological; duplicate tiers are rejected. A stale version cannot overwrite another edit. No PDF extraction or prepared-import service remains. Keep original reference documents in the private archive outside the checkout.

The public Standards view preserves every canonical edition, including historical and future sets. It never converts or invents a cut. Check the printed source carefully before saving.

Validation: `npm run test:swim-resources`, `npm run test:data:database`, and `npm run test:data:browser`.
