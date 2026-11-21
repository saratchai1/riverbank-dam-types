# Review of the riprap and pile + laid-rock source categories

Review date: 21 November 2026. This is a source review and arithmetic audit, not approval of a design. Native source files were not modified. No repository or GitHub writes were made by this reviewer.


> **Integration audit clarification (strict missing-input handling):** The independent engine retains blank source inputs as unknown, even where a cached source product is zero. Toe rock has 1 missing input, front sand 1, facing adjustment 41, and earth fill 2 (including AI128). Therefore 32,840; 148,206; 17,295; and 2,566 are **sums of known contributions after per-reach rounding**, not complete independently verified totals. Geotextile inputs are complete, with one missing original product T25. Sand-back live output remains unknown, not zero. The reported net facing 17,037 remains a source figure; the blank F202 deduction is not silently validated as zero. These stricter qualifications supersede any unqualified “candidate total” shorthand below.

## Recommendation

Use **S6006 บ้านแดนเมือง (ต่อเนื่องเขื่อนเดิมปี 43 เหนือน้ำ), ตำบลวัดหลวง อำเภอโพนพิสัย จังหวัดหนองคาย** as the first demonstration. It has a complete drawing PDF, soil/stability calculation report, and an editable quantity workbook with station-level takeoff inputs. The useful demonstration is a **1,000 m current BOQ arithmetic audit** plus a separately labelled typical-section illustration. The current BOQ scope consists of 286 m and 714 m reaches. Do not describe it as an exact reconstruction of the entire 1,195 m drawing or reproduce the reported Slope/W FS as though calculated by the app.

The supplied sources contain material inconsistencies. Exposing the source, units, formula, original value, independently computed value, and unresolved discrepancy is valuable engineering functionality.

## Inventory and review coverage

The riprap category contains 53 files, and the pile + laid-rock category 23 files, including xrefs, photographs, and support files. Combined file types: 9 PDFs, 2 DOCX, 1 XLSX, 1 XLSM, 12 DWG, 47 JPG, 1 TIFF, 1 PNG, 1 log, 1 DB. All ten nested folders were refreshed at **06:52:23 UTC**, after the user's five-minute upload window; both category roots were refreshed again at **06:55:41 UTC**. No new children were found compared with first discovery.

Exact names, Drive IDs, sizes, modified dates, and URLs are in `file-inventory.csv`, `manifest-final.json`, and `manifest-roots-final.json`. Filenames were used for file inventory only. Native DWG layouts and object geometry have not been audited. Drawing-sheet counts below are actual supplied PDF pages/title blocks, not inferred from DWG filenames.

Downloaded and reviewed: S6006 drawing PDF (46 pages, cover + 45 sheets), calculation PDF (18 pages), combined BOQ PDF (6 pages), and XLSX; PCT-S09 drawing PDF (48 pages, cover + 47 sheets), calculation PDF (12 pages), BOQ PDF (5 pages), and the later calculation DOCX. Representative drawings and calculation tables were visually inspected. Three separate S6006 BOQ PDFs were read as text and correspond to the combined cover, summary, and detail sections. Both calculation DOCX versions were also text-reviewed; the later PCT DOCX contains a material revision absent from its PDF.

## Principal source register

| Key | Drive file ID | Local file | Evidence role |
|---|---|---|---|
| S6006 drawing | `1_4xSWK7Z0dGNkIuleaWB-cOOiFb7Hngc` | `sources/S6006-drawings.pdf` | Plan, sections, dimensions, datum, details |
| S6006 calculation | `1rPYcaPaZLdxwgJ9XuI808WJnzTBlBTnh` | `sources/S6006-calculations.pdf` | Design basis, borings, soil table, reported FS |
| S6006 BOQ workbook | `1tx9RpIdEpdupnImCqv7miC11VaqSVVHL` | `sources/S6006-BOQ.xlsx` | Current budget scope and station quantity arithmetic |
| S6006 BOQ PDF | `1KhxE1gccauEZ2RKUhQfLRp5GbKYW9i3f` | `sources/S6006-BOQ-total.pdf` | Published 1,000 m estimate, 8 January 2561, budget 2562 |
| PCT drawing | `18uN6Wtd9YbS8EY6eUFPyOkSNyAyon3t3` | `sources/PCT-S09-drawings.pdf` | Final drawing, 550 m, paired piles and soil reinforcement |
| PCT calculation PDF | `1WPn6N1mguLUlAOsArThS3OYDfwQgtHFa` | `sources/PCT-S09-calculations.pdf` | CASE I and CASE II, modified 23 December 2024 |
| PCT calculation DOCX | `1Ms8SMNUopR2s96ntUoMtHmE6B_SmtSVc` | `sources/PCT-S09-calculations.docx` | Later CASE II_Rev.2 table, modified 2 January 2025 |
| PCT BOQ | `1YnsUI2rWYSP6eUNR_gTCAryGoLaLAEa-` | `sources/PCT-S09-BOQ.pdf` | Actual 550 m quantities, dated 31 March 2568 |

For direct links, use `https://drive.google.com/file/d/FILE_ID/view`. Office files may use the original docs.google.com URL retained in the manifest.

## S6006 drawing facts

All dimensions in the following table are read from the drawing, not inferred from a screenshot scale.

| Item | Source value | Evidence |
|---|---:|---|
| Full project plan length | 1,195 m | PDF p5, S6006-ST-01, sheet 4/45; start 0+000, end 1+195 |
| Typical crest level | +101.00 m | PDF p36, S6006-SD-02, sheet 35/45 |
| Typical toe crown level | +88.00 m | Same |
| Main facing height | 13.00 m | Same |
| Main facing slope | 2.5H:1V | Same |
| Horizontal run | 32.50 m | Same |
| Crest walkway width | 2.95 m | Same |
| Toe crown width | 1.50 m | Same |
| Facing stone size | 0.20–0.50 m | Same |
| Facing thickness | 0.50 m | Same |
| Compacted submerged sand | At least 1.00 m thick | Same; substantial fill to actual ground may be thicker |
| Toe stone | At least 0.35 m | Same |
| Toe side slopes | 1.5H:1V | Same |
| Minimum toe depth | At least 2.00 m | Same; actual ground dependent |
| High / surveyed / low water | 99.10 / 97.30 / 87.40 m | Same; all drawing assumed datum |
| Survey date | 1 November 2560 | PDF p5 level table |

There is no berm in the principal typical sloping face. The toe is a sloped, ground-dependent rock mass, not a rectangle. An app can show a simplified trapezoid at a user-selected depth if that modelling assumption is explicit, but cannot call its volume the source's actual toe quantity. The geotextile follows the main face and toe interface details and has end closures; its full length is not simply the geometric face hypotenuse.

### Datum and longitudinal variation

Drawing p5 separates surveyed levels and **ค่าระดับสมมุติ**. BM1 is 164.060 / 100.010 and BM2 164.050 / 100.000, establishing an assumed-datum offset of 64.050 m. Water levels are printed in coarser precision: high 163.20 / 99.10, low 151.50 / 87.40, surveyed 161.30 / 97.30. Use the printed assumed levels in the demo, labelled as such; do not call +101 m a national datum elevation without conversion.

The typical +101 m crest is not valid at every station. PDF p34, S6006-ST-30, shows station 0+005 with crest +100.10 m and face run 30.25 m. PDF p20, S6006-ST-16, shows stations 0+700 and 0+675 with crest +101, toe +88 and highly variable existing ground. PDF p10, S6006-ST-06, labels the end section 1+196, while the plan p5 labels the project end 1+195. PDF p6 has another conflicting end label (1+165) and note (1,196). Keep the full-plan length and individual labels separate until the original designer confirms revisions.

## S6006 current BOQ scope and arithmetic

`S6006-current-quantities.json` is the machine-readable handoff. It preserves each source cell/value/formula, distinguishes blank and explicit zero, provides 41 current station rows, 13 input/quantity column pairs, current BOQ items, source subtotals, arithmetic comparisons, and downstream deductions. `build-current-quantities.py` reproduces that file from `S6006-BOQ-cells.json`. The latter is a read-only extraction of the original workbook XML; no macros, links, or workbook calculations were executed.

Current budget length is the literal 1,000 in `ข้อมูลโครงการ!R3`. `ป.2!J8=G10+G12` combines 286 and 714 m. The takeoff sheet `หาปริมาณวัสดุ` uses rows 14–25 (station 0 through 275, assigned lengths totalling 286) and 104–132 (station 300 through 1000, assigned lengths totalling 714). Row 25 has 23.5 m and row 104 26.5 m; these weights locate the inferred reach boundary at 286 m. Rows 133–139 still contain station 1025–1175 input geometry but have blank effective lengths and zero quantity contributions. Do not add them to current totals.

The separate visible `บ.3` sheet has 1,222 m from 286 + 714 + 222, linked to `หาปริมาณวัสดุ!F6/F95/F159`. The third block restarts station labels. It is not the current BOQ. Legacy `บ.2` includes #REF! formulas. Other visible/hidden sheets contain older or unrelated components, so importing the entire workbook as one design would be unsafe.

### Reproducible method

For every current row, independently compute `source cross-section area × effective longitudinal length`. For geotextile, compute `source section length × effective longitudinal length`. Allowances use `source width × 0.30 m × effective length`, where 0.30 m is `หาปริมาณวัสดุ!F7`. Preserve reported end-closure additions as a separate source quantity. Sum each reach, then apply the source's ROUNDDOWN separately for each reach. Do not round only after combining the reaches.

These are independent arithmetic calculations using supplied takeoff inputs, not independently surveyed or CAD-extracted areas. The source area input can itself be challenged; the app should show its origin rather than imply geometry verification.

| Item | Original adopted quantity | Independent arithmetic candidate | Unit / explanation |
|---|---:|---:|---|
| Excavation | 19,417 | 19,417 | m³; section cut plus 0.30 m surface allowance |
| Toe rock plus reported end closures | 32,840 | 32,840 | m³ |
| Front sand fill | 148,206 | 148,206 | m³ |
| Front geotextile plus reported end closures | 40,035 | 40,985 | m²; missing T25 candidate only |
| Facing riprap before stairs | 17,295 | 17,295 | m³ |
| Facing after source stair deductions | 17,037 | 17,037 | m³; deduct 86 + 172 from separately rounded reach quantities |
| Earth fill | 1,694 | 2,566 | m³; missing AJ quantities candidate only |

The unrounded independent totals are 19,417.5724 m³ cut, 32,841.100978 m³ toe with reported closures, 148,206.99235 m³ front sand, 40,986.847 m² geotextile with reported closures, 17,296.25 m³ facing before stairs, and 2,567.186 m³ earth fill. All arithmetic candidates must be displayed alongside the reported quantity pending source-author confirmation.

### Specific source issues

1. `T25` is a styled blank cell with no value/formula. The source has `S25=40.425 m` and `B25=23.5 m`, whose product is **949.9875 m²**. The source SUM omits it. Replacing the blank only as an audit candidate increases the final separately rounded total by 950 m². It is not an authorised source correction.
2. `AJ125:AJ132` are blank quantity cells. Seven corresponding `AI` areas are nonzero, giving omitted products 11.5, 9.8, 45.325, 157.025, 153, 341.175, and 153.9 m³, total **871.725 m³**. The separately rounded candidate is 2,566 versus reported 1,694 m³. No merged cell range explains these blanks.
3. Current `ป.3!J14/J56` includes **514 + 1,285 m³ of 2×6×0.30 m mattresses**. The intermediate summary has adjacent `P15/P192` text “ไม่มี”, and the reviewed S6006 typical detail shows a rock toe without a mattress. Retain the BOQ line as reported and mark drawing/revision confirmation pending; do not silently remove or assert it has been verified.
4. The current BOQ PDF and XLSX both show 286/714 m and historical estimate approximately 120 million baht. Prices/Factor F belong to the original 2018 estimate; they are not current quotations.
5. Workbook drawing references stop at ST-29/SD-07 while the supplied drawing set includes ST-30/SD-08. This reinforces the need to reconcile source revisions.

## S6006 calculation report: what is and is not reproducible

PDF p1 supplies historical material assumptions: reinforced concrete 2.4 t/m³, rock 2.2 t/m³, sand 2.0 t/m³, earth 1.8 t/m³, and surcharge 1.0 t/m². References include ACI318-02, PCI fifth edition (1999), and AISC ASD ninth edition. Report these as original project references, not current universal standards.

PDF p2 provides flow-sizing relationship `Δm D = 0.035 (φ/ψ) (KT Kh/Ks) (ucr²/(2g))`. It describes a protective-layer thickness D, relative submerged density, stability/protection factors, turbulence, depth, and slope factors. PDF p3 provides a wave relationship. There is no populated, project-specific velocity/coefficient calculation yielding a required stone diameter or thickness. The app should not claim a hydraulic pass from the mere fact that the drawing specifies 0.20–0.50 m stone and 0.50 m thickness. A future hydraulic module needs sourced velocity/depth/gradation and a verified applicable standard and interpretation of these equations.

PDF p16 soil model lists medium clay γ20 kN/m³, c30 kPa; very stiff clay γ21, c90; hard clay γ22, c500; sandfill γ20, φ32°; riprap γ22, φ36°. Dashes are not validated zero values; the stress/drainage interpretation must be established before reproducing an analysis.

Reported source FS: existing **3.378 ≥1.3**, designed **2.588 ≥1.5**, rapid drawdown **2.164 ≥1.3**, on PDF pp16–17. These can be shown in a “ผลรายงานต้นฉบับ” panel with case and page, never as output of the new app. No native Slope/W model, mesh, critical slip-surface search, or complete numeric boundary conditions were supplied in the files reviewed.

## Pile + laid-rock category: PCT-S09

Project: **เขื่อนป้องกันตลิ่งริมแม่น้ำน่าน บ้านคลองเจ็กเสี่ยง หมู่ที่ 2 ตำบลไทรโรงโขน อำเภอตะพานหิน จังหวัดพิจิตร**, code 67-PCT-S09. Procurement/calculation title says length not less than 460 m; drawing cover and actual BOQ use **550 m**. BOQ dated 31 March 2568 is 89,736,000 baht adopted; unrounded total 89,736,990 baht.

Drawing PDF p20, sheet19/47, 67-PCT-S09-SD01, shows crest +100, facing top +97.50, toe crown +90.90, main face 2.5H:1V with 16.50 m run, stone 0.20–0.50 m and 0.50 m thickness, sandfill ≥1 m, and toe mattress 2×6×0.30 m. Water high/survey/low are 99.4/95.5/90.3 in drawing assumed datum. A-pile is 0.30×0.50×18 m, B-pile 0.30×0.40×18 m, both at 1 m longitudinal spacing; D-pile is 0.22×0.22×11 m in five ground-reinforcement rows at 1 m spacing. The drawing explicitly calls D piles soil reinforcement; they are not a conventional deadman anchor system. A paired-pile structural cap, panel facing, drainage blanket/channels, soil-reinforcement piles, riprap slope, toe mound and mattress must be represented separately.

BOQ pp3–4 confirms 9,727 m³ toe/end rock, 990 m³ mattress, 21,356 m³ front sand, 12,907 m² front/end geotextile, 5,947 m³ facing stone; 2,755 D piles, 554 A piles, 550 B piles, 6 C piles (0.30×0.40×16 m), and 2,204 panels. These are reported source quantities, not remeasured by this review.

Calculation PDF p3 explicitly uses effective parameters γsat, c′, φ′, E′, ν, and records Plaxis2D structural actions. CASE I has A/B19.5m, D12.5m, FS1.774 LWL and1.412 rapid. CASE II has A/B18m, D11m, FS1.700 and1.409. However the later DOCX contains **CASE II_Rev.2 / 5 D-Piles / same as CASE II / FS1.659 and1.400** in native table3, rows7–8. This extra case is absent from the older PDF. Five D piles in the drawing may correspond to that revision; designer confirmation is required before assigning a unique controlling FS.

Table2.2 also lists B-pile shear max6.631/min−9.000 kN/m, but amplified demand11.27 =1.7×6.631 rather than1.7×9.000=15.30. This is a traceability question, not proof of unsafe design or a reason to endorse the original pass. Table2.2 also omits cap-beam capacity results. A later app module must support signed force envelopes, case selection, units, structural capacity calculations, drainage/soil conditions, and independent model validation.

## Product implications

The first credible release can reproduce station quantity arithmetic, show exact evidence per input, expose gaps, display a source-faithful typical geometry, and keep original analysis results separate. It should not claim automatic soil design, hydraulic suitability, full geotechnical stability, or current construction pricing from these documents. PCT-S09 provides a useful future design-pattern reference but requires a substantially richer structural and geotechnical model than one row of cantilever piles.
