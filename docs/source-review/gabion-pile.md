# Review of gabion and straight-pile / dumped-rock source projects

Review date: 21 November 2026 UTC. Source inventory: 10 descendant folders refreshed at 06:51 UTC; both category root folders refreshed at 06:55 UTC. No additional files were observed after the user's five-minute upload estimate. This is a snapshot, not a declaration that the owner has finished uploading.

## Main finding for the app

Both supplied categories contain coherent construction-drawing PDFs, calculation-report PDFs, and BOQ PDFs, plus native working files. **Neither project can be validated by a generic gravity-wall sliding/overturning screen.** The gabion example is a piled RC foundation carrying stepped gabions. The straight-pile example has A/B structural pile rows, panels/cap beams, and four transverse rows of D reinforcement piles below the rock. Their reports use Plaxis 2D effective-stress analysis, layered soil, low-water and rapid-drawdown cases, and separate pile moment/shear checks.

These examples support the app's system classification, required-input lists, source evidence, quantity taxonomy, and engineer-review questions. Their reported factors of safety should be shown as **external source results for a named source case**, never as results recalculated by an unrelated app model. Riprap S6006 remains the separate proposed single demonstration; this review does not validate that project.

## Inventory and review coverage

| Category | Files | Working DWG files in drawing folder | Xref/support files | Main PDF set |
|---|---:|---:|---:|---|
| Gabion CMI-S01 | 29 | 7 | 17 | 87-page drawings; 7-page calculation report; 7-page BOQ |
| Straight pile / rock PNB-S03 | 34 | 7 | 22 | 65-page drawings; 10-page calculation report; 7-page BOQ |

There are five descendant folders in each category, plus the category root. The full IDs, titles, byte sizes, timestamps, paths, and parent-folder relationships are in `manifest.json`. The six main PDFs were downloaded and all pages had text extraction attempted. Calculation reports and BOQs were read; key calculation tables and result pages, drawing covers/contents, typical sections, and selected material/geotechnical sheets were visually inspected. Many drawing pages are outlines/scans with little extractable text. This review is **not** a complete dimension audit of every cross-section. DWG LAYOUT tables, XLSM formulas/macros, DOCX differences, and support photos were inventoried but not independently audited. The PDF page counts are verified PDF counts, not inferred DWG sheet counts.

## Source register

| Key | Source | Drive file ID | Page references used |
|---|---|---|---|
| G-DWG-PDF | [_Final 67-CMI-S01.pdf](https://drive.google.com/file/d/1_OY4rLyuXL1LF8M6Crp5HrFQxeAwwSjw/view) | `1_OY4rLyuXL1LF8M6Crp5HrFQxeAwwSjw` | 2 contents; 53 SD01; 79 SD27; 83 GT01 |
| G-CALC | [67-CMI-S01 รายงานผล.pdf](https://drive.google.com/file/d/1EqOz-dVJVmjmDfRfdLLqAcXnGABJ56Z1/view) | `1EqOz-dVJVmjmDfRfdLLqAcXnGABJ56Z1` | 1–2 method/inputs/checks; 4–5 FS; 6–7 force diagrams |
| G-BOQ | [S01 เชียงใหม่.pdf](https://drive.google.com/file/d/15bdN9naRYBbwV9T9dh1N32tMxfhHeyf4/view) | `15bdN9naRYBbwV9T9dh1N32tMxfhHeyf4` | 1–2 summary; 3–6 quantities; 7 tests |
| P-DWG-PDF | [_Final-67-PNB-S03-ส่งงวดงาน.pdf](https://drive.google.com/file/d/1bSYMeau6WbOBlONqTh6sa-JJMU83t2c2/view) | `1bSYMeau6WbOBlONqTh6sa-JJMU83t2c2` | 2 contents; 36 SD01; 37 SD02; 61 GT01; 65 GT05 |
| P-CALC | [67-PNB-S03 รายงานผล.pdf](https://drive.google.com/file/d/1beZs25z14csfrKosswhQZ2JvLFtkvoPC/view) | `1beZs25z14csfrKosswhQZ2JvLFtkvoPC` | 1–2 method/inputs/checks; 4–5 FS; 6–10 force diagrams |
| P-BOQ | [S03-เพชรบูรณ์-boq.pdf](https://drive.google.com/file/d/1oBtRqQc7KkjzgYD-EDhF9eyfADpqNPPG/view) | `1oBtRqQc7KkjzgYD-EDhF9eyfADpqNPPG` | 1–2 summary; 3–6 quantities; 7 tests |

All page references mean the 1-based PDF page. Drawing sheet numbers are one less because the PDF includes a cover.

## 1. Gabion project CMI-S01, Chiang Mai

**Identity.** เขื่อนป้องกันตลิ่งริมแม่น้ำขาน หมู่ที่ 11 ตำบลบ้านกลาง อำเภอสันป่าตอง จังหวัดเชียงใหม่; กรมโยธาธิการและผังเมือง. The title says length not less than 1,200 m, while BOQ Pr.4 measures two reaches of 1,035 and 885 m, totaling **1,920 m**. Use measured reach lengths, not the minimum title, in quantity comparisons. G-BOQ p1–6.

**Typical section (G-DWG-PDF p53, 67-CMI-S01-SD01, drawing sheet 52/86).** The section shows three approximately 1 m gabion lifts, PVC-coated nominal 1×2×1 m boxes, RC foundation **4.20 m wide**, and **four pile rows in cross-section**. Piles are 0.26×0.26 m; transverse center spacing is 1.00 m with 0.60 m edge-to-center distances. The length schedule is reach 1 STA 0+000–0+400: 5.00 m; STA 0+401–1+035: 7.50 m; reach 2 STA 0+000–0+885: 10.00 m. The report covers only the 5 m case at reach 1 STA 0+200; its output does not automatically validate the 7.5 m or 10 m cases. The walkway is shown 3.00 m overall. Drawing levels include crest +99.00, base of gabion +95.85, average highest water 100.1, average lowest water 95.9, and survey water 96.1 m. Datum and station alignment must be retained explicitly.

**Components and specifications.** Gabion boxes, piled RC foundation, backfill sand, geotextile, dumped-rock toe/end protection, walkway, stair structures, rails and drainage are separate BOQ families. SD27 (p79) specifies gabion and mattress mesh/diaphragm/lacing details, filling-rock ranges, and geotextile properties. The gabion filling-rock range is 15–25 cm; this must not be confused with the typical section's dumped-rock toe minimum size of 0.35 m. SD01 shows toe rock at least 1.00 m thick. Geometry and material labels must stay associated with the relevant component.

**Calculation basis (G-CALC p1–2).** Plaxis 2D, effective-stress analysis, clay described as Undrained B. Source criteria: FS 1.5 for normal condition and 1.3 for rapid drawdown. These are the report's stated criteria, not a verified current universal standard. Soil inputs include saturated unit weight, undrained shear strength for clay, friction angle for sand, stiffness E′, and Poisson ratio. A single homogeneous c′/φ′ soil card cannot reproduce this model.

| Source material | γsat kN/m³ | Su kPa as labelled | φ′ degrees | E′ kPa | ν |
|---|---:|---:|---:|---:|---:|
| Sand loose | 17 | — | 29 | 6,000 | 0.3 |
| Sand medium dense | 18 | — | 29.5 | 10,000 | 0.3 |
| Sand 1 medium dense | 18.5 | — | 32.5 | 15,000 | 0.3 |
| Clay very stiff | 18 | 150 | — | 30,000 | 0.4 |
| Clay hard | 20 | 200 | — | 50,000 | 0.4 |

The report also lists sand fill and riprap values under the same Su-labelled table column, alongside φ. Their constitutive/material interpretation must be clarified before mapping to an app's c′ field. Do not silently relabel Su as effective cohesion.

**Reported results.** Low-water FS **3.047** (G-CALC p4); rapid-drawdown FS **3.029** (p5). On p2, D-pile extrema are Mmax +0.329 and Mmin −6.284 kN·m/m, Vmax +4.365 and Vmin −3.264 kN/m. The table gives factored demands 10.48 and 7.28, capacities Mu 69.98 and Vu 162.55, and O.K. The force-unit labels must be preserved: per-metre plate results require explicit conversion to per-pile demand when pile spacing differs.

**Quantity examples (G-BOQ p3 / Pr.4 1/5, reach 1).** Gabion filled-and-installed volume 8,991 m³; rock toe/end 2,322 m³; backfill sand 3,711 m³; geotextile 5,944 m²; 5 m foundation piles 1,556; 7.5 m foundation piles 2,468; separate 5 m stair piles 360. Reach 2 (p5 / Pr.4 3/5) gives gabion 7,965 m³, rock 5,484 m³, sand 4,854 m³, geotextile 5,329 m², 10 m piles 3,448 and separate stair piles 240. Nominal box volume is 2 m³, but the odd total 8,991 m³ must not be converted to a whole-box count without takeoff rules for partial/end boxes. BOQ quantities are whole-reach quantities, not outputs from the single STA 0+200 section.

**Cost provenance.** G-BOQ is dated 29 May 2568; rounded summary 119,695,000 baht (unrounded 119,695,807). It uses different Factor F values for irrigation and bridge-type work. These are historical source rates and source categories; do not present them as current quotations.

## 2. Straight-pile / dumped-rock project PNB-S03, Phetchabun

**Identity.** เขื่อนป้องกันตลิ่งริมแม่น้ำป่าสัก ต่อเขตเทศบาลเมืองหล่มสัก หมู่ที่ 3 (ท่ามะกล้วย) ตำบลวัดป่า และหมู่ที่ 3 ตำบลหนองไขว่ อำเภอหล่มสัก จังหวัดเพชรบูรณ์. The title says at least 1,000 m; BOQ measured reaches are 160 and 1,025 m, totaling **1,185 m**. P-BOQ p1–6.

**Typical sections (P-DWG-PDF p36–37; 67-PNB-S03-SD01/SD02, sheets 35–36/64).** A piles are 0.30×0.50×18.00 m, B piles 0.30×0.40×18.00 m, with 2.20 m transverse separation. Both are @1.00 m longitudinal spacing. D piles are 0.22×0.22×11.00 m, four transverse rows @1.00 m, supporting the toe/reinforced ground. Rock is at least 0.35 m size, with rock toe thickness at least 1.50 m in typical 1 and bank-slope rock at least 1.00 m in typical 2. A solid retaining panel, caps/RC walkway, upper RC wall, sand backfill and geotextile complete the system. Typical 1 vs 2 varies with chainage and bank/bed geometry; the D-pile offsets and head levels differ. Thus one arbitrary section and one pile row do not describe this whole project.

Drawing levels: crest +99.50 to +100.00, rock top +97.00 to +97.50, D-pile head +95.30 to +95.80 in typical 1; +93.50 in typical 2. Average highest water is 99.5; lowest 92.1; survey water 92.5 m. These are drawing source values, not an established design hydrograph or scour design.

**Calculation basis (P-CALC p1–2).** Plaxis 2D effective stress, straight dual piles 18 m and D piles 11 m at STA 0+150. Normal/rapid-drawdown criteria stated as 1.5/1.3. The property table gives sand medium dense γsat18, φ′30.5°, E′17,000, ν0.3; medium clay γsat18, Su59, E′9,000, ν0.3; very stiff clay γsat19, Su94.6, E′30,000, ν0.4; hard clay γsat20, Su134.5, E′40,000, ν0.4; and very soft clay γsat16, Su20, E′6,000, ν0.4. Units are kN/m³ and kPa as applicable. Backfill sand/riprap rows have the same table-heading interpretation issue as CMI.

**Reported stability.** Low-water FS **1.641** (P-CALC p4); rapid drawdown **1.591** (p5). The normal-case margin is considerably smaller than in the CMI example; it still remains a report output for its specific model, not a result available from the app's gravity-wall engine.

| Element | Maximum absolute M from source | Source factored M | Source Mu | Maximum absolute V | Source factored V | Source Vu |
|---|---:|---:|---:|---:|---:|---:|
| A pile | 29.77 | 49.63 | 175 | 11.71 | 19.54 | 344 |
| B pile | 16.11 | 26.86 | 144 | 10.50 | 17.52 | 265 |
| D pile | 6.515 | 10.85 | 68.5 | 4.851 | 8.09 | 138 |

P-CALC p2 labels moment kN·m/m and shear kN/m. Cap-beam extrema are also shown (M −6.902/−24.72, V +31.77/−29.87), but factored demand/capacity cells are blank. Do not synthesize a cap-beam pass status. The report does not provide full reinforcement-capacity derivations in this short PDF.

**BOQ traceability (P-BOQ p5 / Pr.4 3/5, reach 2).** Rock 9,963 m³, sand 8,408 m³, geotextile 6,150 m², D piles 4,104, A piles 1,029, B piles 1,025, C end piles 0.30×0.40×16 m: 18. Panel and cap-beam work continues on p6. A useful consistency calculation is 4 rows × (1,025 intervals at 1 m + 1 end position) = **4,104 D piles**. This exactly matches that BOQ row, but is only a checked inference: endpoint/transition/omission rules must be confirmed against pile plans before becoming the general quantity algorithm. The different A/B counts demonstrate why `length/spacing` alone is insufficient.

The source BOQ is dated 11 March 2568. The rounded source project total is 133,172,000 baht (unrounded 133,172,241). Rock and sand haul assumptions and Factor F are source-specific historical inputs. Keep them separate from current price data.

## 3. Issues the engineer-facing calculation book should expose

1. **Factor discrepancy in both reports.** The footnote on each calculation p2 says multiply by 1.7, while demand columns are approximately a 1.667 factor. CMI D-pile |M|6.284×1.7=10.6828, versus printed10.48; |V|4.365×1.7=7.4205, versus7.28. PNB A-pile29.77×1.7=50.609 versus49.63;11.71×1.7=19.907 versus19.54. These were visually confirmed. Preserve both the source value and independently recomputed value; request the factor/conversion explanation. Do not silently fix the source or pronounce the structure unsafe from this discrepancy alone.

2. **PNB layer mapping needs reconciliation.** The model legend has sand from100→94.5, medium clay94.5→87, another sand87→82, very stiff clay82→76, hard clay76→72. Its material-property table includes very soft clay, which is not unambiguously assigned in that legend. Mapping by row number is unsafe. Model-top100 is a model level; link it explicitly to the drawing datum and cross-section before transferring levels.

3. **Geotechnical evidence exists.** Do not state that the projects have no boreholes. G-DWG-PDF GT01–05 includes logs and locations; p83 includes BH1 and BH2, loose/medium sands and stiff/hard clays. P-DWG-PDF GT01–05 includes logs and design/construction borehole locations; p61 shows BH1 and BH1R with different ground levels and layered very soft/soft clays; p65 shows BH6. What remains missing from a reproducible app run is the explicit borehole-to-section correlation, parameter derivation, drainage/constitutive selections, model file, groundwater/phreatic scenario, and pile/soil-interface settings.

4. **Hydraulic derivation is not established by the typical sections.** Observed average high/low water labels and toe-rock dimensions are present. This short source set does not establish a reusable velocity/discharge, design-flood return period, scour-depth, riprap-size or transient drawdown derivation. The app should distinguish a specified drawing value from a hydraulically calculated value.

5. **Source scope and revision.** The PNB PDF calc modified timestamp is 19 Nov2026, but its DOCX counterpart is5 Mar2025. This is a revision provenance question, not proof of a content difference. CMI drawing DWG timestamps also extend later than the calculation report. Treat the downloaded PDFs as the examined revisions and require revision coordination before claiming construction readiness. PNB BOQ p1 lists SD01–SD23, while the drawing contents includes SD24; this is another specific drawing/BOQ index reconciliation point.

6. **Model completion gates.** For these types require section/chainage, soil stratigraphy and drainage basis, groundwater cases, actual pile geometry/spacing/materials, cap/panel load path, imposed loads, construction sequence, stability methodology, and structural capacity checks. A basic geometry/BOQ preview may be allowed without a geotechnical pass label. Gravity-wall sliding, overturning and bearing outputs should be marked not applicable to the whole piled system, rather than passed using gabion self-weight.

## 4. Reusable calculation and evidence structure

Use separate fields for `source_value`, `app_input`, `assumption`, `computed_result`, and `review_status`. Every record needs project/reach/station, source file ID and PDF page/sheet, original units, conversion, and method applicability. The calculation book can then show:

- Geometric quantities: polygon or section area; segment volume V = Σ[(Ai + Ai+1)/2] ΔLi; actual segment endpoints and exceptions.
- Pile quantity: explicit rows × positions per segment, with end transitions and stairs separate. Show the PNB 4,104-pile inference as a traceability example, not a blanket rule.
- BOQ amount: source quantity × source rate, followed by the correct source work-category Factor F and source rounding rules. Keep separate fiscal date/version.
- External engineering output: named software/method and source model case, FS/force/capacity, applicable criterion, plus reproducibility status. Do not call these internally verified calculations.
- Reconciliation: source demand vs recomputed factor arithmetic; source property table vs model-layer mapping; drawing length vs title minimum vs BOQ measured length.

The PDF source reports are evidence of prior engineering analysis. The app's own credibility must come from a matching method, traceable inputs, unit discipline, transparent limitations, and independently checkable arithmetic, rather than copying their O.K. labels.
