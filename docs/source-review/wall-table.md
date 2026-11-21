# L-Wall and pile-platform source review

Reviewed 21 November 2026. Final Drive refresh: **06:52:56 UTC**, after the user's estimated upload completion. Both category roots and all ten nested folders were refreshed. **No new, removed, or metadata-changed file was detected** against the initial listing. L-Wall contains **19 non-folder files**; pile-platform contains **21 non-folder files**. See manifest-final.json for exact IDs, names, parent folder paths, sizes and provider modification dates.

## Review scope and confidence

Downloaded eight primary sources: the two drawing PDFs, PBI-05 stability PDF, PBI-05 BOQ PDF and XLSM, AYA-S03 BOQ XLSX, and AYA-S03 ESA/TSA GSZ models. Read PDF text, rendered and visually inspected the critical engineering tables and typical sections, inspected complete PDF thumbnail contact sheets, read spreadsheet cells and formulas without saving or running macros, and inspected GSZ XML and archive entries without executing the engineering models. DWG files, backup files, title-block xrefs, survey photos, and the duplicate PBI-05 stability DOCX were inventoried but not independently parsed in this review. **PDF page counts are not assertions about DWG layouts.**

This evidence supports explaining the workflow and checking selected arithmetic. It does **not** establish that either project is fully validated, that all drawing revisions agree, or that a new app reproduces the native engineering solvers.

## Source register

| Key | Drive ID | Source | Exact useful location |
|---|---|---|---|
| PBI-STAB | 1aggRm1wkaRbR8AQcEopVJbfQxKD2FFPS | Stability report (PBI-05).pdf, 8 PDF pages | pp1–4; Table2.1,2.2,2.3 |
| PBI-DWG | 1qSRUYkSrn14uZje6Zj2E_WDCCRjCYs3j | _PBI-05-ส่งงวดงาน.pdf, 45 PDF pages | p24:67-PBI-05-SD01, printed sheet23; p33 general notes |
| PBI-BOQ | 1Qfri4KMOmQcABVy105NfScNflGsid_TQ | PBI-05_BOQ.pdf, 7 PDF pages | pp1–2 summary; pp3–6 reach BOQ; p7 tests |
| PBI-XLS | 1pKe1Lt003jpWV0VcQP9Gi0mGEaEAXnYm | PBI-05.xlsm | 3.ปร.4 BOQ; 4.สรุปปริมาณงาน; 5.งานหาปริมาณ |
| AYA-DWG | 1kpnfAoelhJuIvgnibkyqpayaULkwyJ9P | _แบบแก้ไขสัญญาครั้งที่ 1 AYA-S03_ตัดระยะ.pdf, 50 PDF pages | p23:64-AYA-S03-SD01.R, printed sheet22/49, Jan2568 |
| AYA-XLS | 1FDibEWtPMvFbwZX0wQb4HWBElXZc8FV- | 68-01-21 ส. (ตัด101ม.) ม.4 ต.บางหลวง อ.บางบาล จ.อยุธยา.xlsx | 3.ปร.4 (ก) and 3.ปร.4 (ท) |
| AYA-ESA | 1yLxcGQ9HE45UlUtDctqeG9kCBSo3FAnc | STA.x+xxx_ESA.gsz | root STA.x+xxx_ESA.xml, Analyses, Materials |
| AYA-TSA | 1-Eh_ZfWbHiSAd1ea6D8nUytudauQqVwZ | STA.x+xxx_TSA.gsz | root STA.x+xxx_TSA.xml, Analyses, Materials |

Provider link pattern for any source: https://drive.google.com/file/d/DRIVE_ID/view

## 1. PBI-05: piled platform with retained fill, deck and toe protection

Project: Phetchaburi riverbank protection from Wat Tha Khoi to Tha Yang district office, Tha Yang, Phetchaburi. BOQ states **623m**, split into **535m + 88m**. The stability-report title states length **not less than600m**, with the analysed section explicitly **STA0+300**. The different description is a scope/version item to resolve, not automatic proof of an error.

### Geometry and component mapping

Visually verified on PBI-DWG PDFp24 / 67-PBI-05-SD01:

- Crest level **+100.00m**; rock crest **+97.50m**.
- Average high water **99.6m**, low water **91.9m**, survey water **92.1m**. Drawing notes say levels are assumed datum metres; they are not established national elevations by this review.
- Rock toe slope labelled **1:1.5**, minimum rock size **0.35m**, minimum thickness **1.00m**.
- Compacted sand retained by concrete panels with geotextile; beams GB1, B1, B2, BA1, BA2; deck S1, lower S0, columns C1, railing and drainage.
- Pile A **0.30×0.50m @1.00m,15m long**.
- Pile B **0.30×0.40m @1.00m,15m long**.
- Pile C **0.30×0.40m @3.00m,15m long in the typical section**.
- **Revision discrepancy:** PBI-BOQ pp3 and5, and PBI-XLS 3.ปร.4 BOQ!B22/B59 instead describe pile C as **13m long**. Preserve the two citations; do not silently choose one.

This is a **three-row supported platform**. The current app's conceptual one-row T3 cannot represent its support system, cap/deck frame, load path, or complete quantities just by selecting T3 and entering its height.

### Stability methodology actually evidenced

PBI-STAB p1 lists Mohr–Coulomb sand with drained effective parameters, clay options Undrained(A) effective c′/φ′ and Undrained(B) total cu, drained embankment, and linear-elastic nonporous slab. The p1 cross-section has six soil layers and surface surcharge arrows. No numerical surcharge value is established from the inspected text.

PBI-STAB pp3–4 contain **Plaxis2D safety-phase screenshots**. The screenshot explicitly reports cumulative strength-reduction factor ΣMsf. The reported results are:

| Case | Reported FS | Project report criterion | Source |
|---|---:|---:|---|
| LWL | 1.559 | ≥1.50 | p3 Table2.3 and LWL_FS Phase6 |
| Rapid drawdown | 1.516 | ≥1.30 | p3 Table2.3; p4 RDD_FS Phase8 |

These criteria are **the supplied report's criteria**, not a newly verified universal standard. Native Plaxis project files, complete phase definitions, surcharge schedule, mesh convergence, boundary settings, and capacity derivations were not found in this category's calculation folder (only PDF/DOCX report). Reported FS can be stored as a cited external result for its source case and station; geometry changes must break any claim that the old result still applies.

### Soil inputs verified from Table2.1, PDFp2

| Material | γsat kN/m³ | c′/cu kPa as table labels it | φ′° | E′ kPa | ν |
|---|---:|---:|---:|---:|---:|
| Clay stiff |18|55|0|12700|0.4|
| Clay very stiff |18|130|0|28500|0.4|
| Clay medium |17|50|0|11000|0.4|
| Sand medium dense |18|0|31.48|15000|0.3|
| Clay hard |20|210|0|50000|0.4|
| Sand dense |20|0|34.50|37000|0.3|
| Sandfill |18|0.50|34|40000|0.3|
| Riprap |22|10|40|50000|0.2|

Do not transplant these site-dependent inputs into the riprap demo unless that demo explicitly identifies them as an independent illustrative assumption. Retaining the c′/cu ambiguity matters; the report gives drainage-mode options rather than an unambiguous per-layer implementation table.

### Structural demand check reproducible from Table2.2, PDFp2

The report's symbol Ø is explicitly defined in its note as a **load amplification factor1.7 applied to Plaxis2D demand** before comparing with prestressed-pile ultimate capacities. It is **not** a strength-reduction factor on capacity.

| Member | Mmax / Mmin kNm | Amplified absolute M | Listed Mu kNm | Vmax / Vmin kN | Amplified absolute V | Listed Vu kN |
|---|---:|---:|---:|---:|---:|---:|
| A |24.89 /−11.09|42.313|174.97|9.15 /−12.63|21.471|344.08|
| B |14.35 /−13.26|24.395|143.74|11.97 /−9.445|20.349|265.82|
| C |15.63 /−9.451|26.571|143.74|5.948 /−7.448|12.662 rounded|265.82|
| Cap beam |17.32 /−21.09|not given|not given|not given|not given|not given|

Arithmetic example: **1.7×max(|24.89|,|−11.09|)=42.313kNm <174.97kNm**. The source leaves cap-beam comparison cells blank. Do not turn the table's overall “O.K.” into a claim that all frame members and connections have been designed.

### Quantity and cost trace, with exact workbook addresses

PBI-XLS **5.งานหาปริมาณ!K11=1.418m²**, **K12=1.261m²**, **D12=0m**, **F12=25m**.
Cell **L12** is:
`=(K12+K11)/2*($F12-$D12)`
and its cached result is **33.4875m³**.

This supplies a concrete evidence chain for the average-end-area method:
**V=(A₀+A₁)/2×ΔL=(1.418+1.261)/2×25=33.4875m³**.
It is a segment quantity, not the whole project's excavation total.

PBI-XLS **4.สรุปปริมาณงาน!F25=11044.715631459994m³** for total riprap; **O25=ROUNDDOWN(F25,0)=11044m³**. **3.ปร.4 BOQ!N13** links to O25. With source historical rate **P13=539THB/m³** and **R13=1.2086**:
- **Q13=ROUNDDOWN(P13×N13,0)=5,952,716THB** base cost.
- **S13=ROUND(P13×R13,2)=651.44THB/m³** adjusted unit rate.
- **T13=ROUNDDOWN(S13×N13,0)=7,194,503THB** line amount.

The order of rounding is evidenced and explains why applying FactorF once to the final subtotal can disagree. These are historical BOQ settings, not current rates.

PBI-XLS **T94=75,023,392THB**, **T96=ROUNDDOWN(T95,−3)=75,023,000THB**. PBI-BOQ p2 confirms reach1 **63,081,547**, reach2 **11,864,265**, tests **77,580**, summing75,023,392 before truncating to thousands. Formula chain is archived in extracted/pbi-selected-formulas.json. Some non-output template cells contain #REF! (e.g. summary labels), so the workbook should not be advertised as cleanly recalculated merely because cached output totals reconcile.

### Major BOQ components, reach1/reach2

| Item | Reach1,535m | Reach2,88m | Unit |
|---|---:|---:|---|
| Strip topsoil |1792|465|m³|
| Excavation |1181|8|m³|
| Riprap |11044|3389|m³|
| Sandfill |8209|1689|m³|
| Geotextile |3210|528|m²|
| Pile A |542|95|pieces|
| Pile B |534|87|pieces|
| Pile C, BOQ13m |196|34|pieces|
| Concrete panels0.67×1.00×0.12m |2146|364|pieces|
| S1 slab |998|113|m²|
| Drainage pits with pipes |26|4|sets|
| Stairs |2|1|sets|

Sources: PBI-BOQ pp3–6 and PBI-XLS 3.ปร.4 BOQ rows11–39,48–77. These varied totals show why a uniform typical section multiplied by total length is not a substitute for chainage-based sections, discrete support locations and special details.

### Standards named in supplied drawing notes

PBI-DWG PDFp33 general notes explicitly invokes DPT/มยผ standards. The concrete note cites **มยผ1101-64 clause4.1.2** for specified durability matters; cement references include **มอก15 เล่ม1**, **มอก2594**, and **มอก849** for the stated cement choices. The standard case mentions 28-day concrete cylinder strength at least210kg/cm² (or cube240kg/cm²), SR24 for6/9mm plain bars and SD40 for bars12mm upward, subject to particular drawing requirements. Rock and geotextile details also have specific notes.

This is evidence of the project's specifications. It does not verify the current legal applicability, edition completeness, or design-code compliance of either the source project or the app.

## 2. AYA-S03: L-wall on piled foundation with ground improvement

Project: Khlong Bang Luang, Moo4, Bang Luang, Bang Ban, Phra Nakhon Si Ayutthaya. The revised BOQ sheets state **150m**. The filename says cut101m; older cached summary text still says251m. The arithmetic251−101=150 is consistent, but archived model-to-revised-section linkage still needs an engineer's confirmation.

### Geometry and component mapping

AYA-DWG PDFp23 /64-AYA-S03-SD01.R, revised contract1, Jan2568, visually shows:
- Crest **+100.00m**; footing/pilecap lower level **+96.00m**, adjacent upper step **+96.50m**.
- Average HWL **99.7m**, LWL **94.7m**, survey water **99.4m**.
- L-shaped wall W1, slab S1, beams B1/B2, columns C1, pilecap, compacted fill, geotextile, drainage and railing.
- Prestressed piles **0.30×0.40×24.00m**, annotated row spacings1m and2m; an inclined row has **1:6 batter**.
- Cement jet grouting **Ø0.80×24m** behind and **Ø0.80×21m** in front. Longitudinal spacing labels **@1.20m**; transverse detail shows centres0.70m. Treat those as different axes, not a single global spacing.
- This is a supported structural system with soil improvement, not a freestanding gravity retaining wall.

### Native model evidence

AYA-ESA/TSA GSZ archives each contain root XML and saved analysis/output folders. Root XML identifies **GeoStudio8.15, build11236**, date10Jun2024 (ESA revision69; TSA revision62). Each root has11 analysis entries:
- steady SEEP/W at **LWL94.70**;
- SLOPE/W variants **LWL**, **LWL+Dam**, **LWL+Dam+SCC**, **LWL+Dam+SCC-2**;
- steady SEEP/W at **HWL99.7**, followed by **Transient Seepage**;
- SLOPE/W **RDD**, **RDD+Dam**, **RDD+Dam+SCC**, **RDD+Dam+SCC-2**.
The slope analyses explicitly declare **Morgenstern–Price**, with pore-water conditions taken from their parent seepage analysis.

The water levels agree with the supplied typical section. **Earlier concern that AYA's datum should be near0m was not supported; the actual drawing uses assumed levels near100m.** There is no datum mismatch evidenced here.

Models contain a material namedSCC and concrete asHighStrength. ESA medium clay has unitweight17, cohesion3.54, friction30.6; verysoft clay15/2/25; soft clay15/2.5/26.5; sand20/33°; sandfill19.5/32°; SCC18/cohesion230; concrete24. These are native field values, not independently revalidated laboratory inputs. ESA/TSA parameters differ in some layers; retain analysis type with each parameter set.

No FS is promoted as a verified project result here. Saved slip-surface CSVs contain mixtures of ordinary numbers and status-like values such as994; source filenames retain generic **STA.x+xxx**, and saved child model revisions differ from root revisions. Native solver review and selection of the controlling, converged, applicable case are needed before presenting any imported value as the design FS. The review neither ran GeoStudio nor inferred a valid minimum by silently dropping large values.

### BOQ and traceability limitations

AYA-XLS contains six sheets: summary, Pr5, Pr4 for variants(ก)/(ท). It relies heavily on external workbook references such as **'[6]4.สรุปปริมาณงาน (ท)'** and **'[6]10.2ราคาต่อหน่วยชลประทาน'**. The uploaded six-sheet file is **not a self-contained quantity/rate calculation model**. Cached values can be read, but the missing dependencies prevent independently recalculating all quantities from it.

In **3.ปร.4 (ก)**:
- D9=150m
- N11 excavation2628m³; N12 geotextile787m²; N13 sand2668m³; N14 compactedsoil621m³
- N17 jetgroutØ0.8×21m **3958m³**; N19 jetgroutØ0.8×24m **7539m³**
- N20 prestressed0.30×0.40×24m piles **377pieces**
- N21 pilecap150m, N22 W1wall156m, N23 C1columns48pieces
- N29 S1slab371m²; N30 stairs1set; N31 drains7sets; N32 railing154m
- T39 **49,410,001THB**, T41 rounded **49,410,000THB**.

In **3.ปร.4 (ท)** the same principal quantities use some different rates; T39=**49,476,293**, T41=**49,476,000THB**. Do not combine variant(ก) quantities, variant(ท) prices and an unrelated total. These figures are historical source values, not a current cost proposal.

## 3. Recommendation for the current demo and engineering explanation

Keep the selected **S6006 riprap** demo. PBI-05 is a useful *second* case for a future multirow platform module and a transparent arithmetic/reference example, but its source pilelength discrepancy and missing native Plaxis file need resolution. AYA-S03 has a complex piled/ground-improved structure, a revised150m scope, generic-station model naming and missing BOQ dependencies; it is a poorer first validation fixture for the current T1/T3 engine.

The app's engineering narrative should distinguish four outputs:

1. **Source parameters:** drawing/member/water/soil values, with project, revision, sheet or cell citation.
2. **App-derived geometry and quantities:** explicit polygons/areas/lengths and quantity formulas. Compare corresponding components, not a whole BOQ total against an incomplete component model.
3. **External engineering results:** method, software/version, case, station, source revision and acceptance criterion. A recorded external FS is not a result of the app's quantity engine.
4. **Open checks:** structural demand/capacity, pile lateral/axial behavior, soil improvement, settlement, seepage, rapid drawdown, scour, drainage, detailing, and source discrepancies as applicable to the chosen type.

This supports a defensible answer to “where does the app come from?”: the project drawings establish component geometry; cross-sections establish measured material areas; transparent formulas integrate areas and count members; engineering solver reports establish case-specific safety results; the app links each output to its evidence and does not create missing evidence.

## Local evidence artifacts

- manifest-initial.json and manifest-final.json: complete category inventory
- extracted/pbi-selected-formulas.json: exact formula/cached-value trace
- extracted/aya-model-methods.json: root model methods and material fields
- extracted/*drawings.json: per-PDF-page text; most vector fonts require visual verification
- images/*overview.jpg: complete PDF contact sheets
- images/pbi05-stability-p1.png throughp4.png: verified report tables/screenshots
- images/pbi05-drawings-p24.png: typical platform section
- images/aya-s03-drawings-p23.png: revised L-wall section
- images/pbi05-notes-left.png: standards/material notes

Raw source files remain in project-review/wall-table/raw and have not been added to git.

