# S6006 second engineering and software review

Review date: 21 November 2026.

**Status: R2 numerical and software verification completed.** This record captures the independent review of baseline commit `89bb513e5f95d34a2dfb3d88346de56fe3058101` and the integrated corrections in implementation commit `9049c109c1b7f9ec946c7f90f02a3592d605fc7c`. The completion section identifies the tested software, workbook, checks, and limits of the review. Completion of this review is not project design approval.

## Scope and meaning of the review

This is numerical and software verification of the selected BF1 beam calculations, homogeneous infinite-slope examples, quantity arithmetic, source interpretation, and accompanying workbook. It is not project certification, a complete code compliance check, a new global stability analysis, or approval of the original design. Source documents were inspected read-only; source workbook formulas, cached values, drawings, and reports were not changed.

The review separates source facts, adopted assumptions, calculated intermediate values, and capacities the software may use to compare with an entered demand. A mathematically computed moment resistance is not, by itself, an allowable comparison capacity when a required condition is unresolved or not met. Similarly, an illustrative infinite-slope FS is not the S6006 global FS.

## Source register and traceability

| Source | Exact location used | Review purpose |
|---|---|---|
| [S6006 construction drawings](https://drive.google.com/file/d/1_4xSWK7Z0dGNkIuleaWB-cOOiFb7Hngc/view) | PDF p5, ST-01; p36, SD-02, sheet 35/45; p39, SD-05, sheet 38/45 | Project length and assumed elevation datum; typical geometry; BF1 dimensions and two reinforcement faces |
| [S6006 calculation report](https://drive.google.com/file/d/1rPYcaPaZLdxwgJ9XuI808WJnzTBlBTnh/view) | PDF pp1-3 and pp16-17 | Historical design basis and material strengths; soil table; original Slope/W case results |
| [S6006 BOQ and takeoff workbook](https://drive.google.com/file/d/1tx9RpIdEpdupnImCqv7miC11VaqSVVHL/view) | `หาปริมาณวัสดุ` rows 14-25 and 104-132, F7, reach totals and closures; `ป.2`, `ป.3`, `สรุปปริมาณงาน` | Selected 1,000 m scope, 41 station rows, 13 components, source blanks, source rounding and downstream deductions |
| [S6006 published BOQ](https://drive.google.com/file/d/1KhxE1gccauEZ2RKUhQfLRp5GbKYW9i3f/view) | Six-page source PDF | Existing estimate and scope context; not a current price source |

Source file fingerprints for the exact local copies inspected:

| File | SHA-256 |
|---|---|
| `S6006-BOQ.xlsx` | `be694c068c32f575ad6f6680f5004e123c1b7a39688a2be79421254f376bd008` |
| `S6006-calculations.pdf` | `5fe3eaf702d24d090fc51a502d19378b2c60584dde1e0e13669590340a1462f3` |
| `S6006-drawings.pdf` | `e2a2c992ffd965c9d15ac5cd553191202c5b2fc855b14f6ab33577e9271b3c8e` |

### Primary technical references

- [USACE EM 1110-2-1902, Slope Stability, 31 October 2003](https://www.publications.usace.army.mil/Portals/76/Publications/EngineerManuals/EM_1110-2-1902.pdf): §2-2 for shear-strength and stress definitions; §C-7, Eqs. C-22 and C-23 for stresses at vertical depth, Eq. C-27 for the dry cohesionless case, and Eq. C-29 for saturated seepage parallel to the slope with its free surface at ground level. These equations are on printed ppC-28 to C-30. Appendix E §E-5, Eqs. E-15 and E-16, printed ppE-14 to E-15, cover the cohesive effective-stress and total-stress extensions; H is explicitly vertical depth. Equation numbers and printed page numbers are different references.
- [StructurePoint spSlab/spBeam Manual v5.50](https://structurepoint.org/pdfs/manuals/spSlabPlusBeam/spSlabPlusBeam%20Manual%20v5.50.pdf): selected historical ACI 318M-02 flexural and shear equations, including the edition-specific minimum stirrup expression. This reference does not establish full current code compliance.
- [StructurePoint spColumn Manual v5.11](https://structurepoint.org/pdfs/manuals/spColumn/spColumn%20manual%20v5.11.pdf): stress block and strain compatibility reference used in the engine.

## Confirmed defects and implemented corrections

The baseline locations below identify the reviewed version. Subsequent edits may change line numbers. Correction acceptance and its evidence are recorded in the completion section.

### R2-01: minimum flexural reinforcement did not gate usable moment capacity

**Baseline locations:** `projects/s6006/engineering.js`, `calculateBeam`, external-demand utilization and the `external-moment` check; matching workbook demand comparison.

With `DEFAULT_BEAM_INPUTS` and `externalMuKnM: 30`, the baseline could report the moment comparison as satisfied although As = 226.194671 mm² was below As,min = 399.728755 mm² and the minimum-steel exception remained unimplemented. The structural reviewer independently obtained As,required = 193.422062 mm² for that local demand with phi = 0.9; 4/3 of that value is 257.896082 mm², still greater than the supplied steel. The exception therefore cannot be presumed to rescue this reproduction, and it also requires the applicable broader design conditions.

**Implemented correction:** preserve `phiMnKnM` as the computed mechanical intermediate and introduce `usablePhiMnKnM`. The usable value requires the yield assumption, minimum tensile strain of 0.004, and the implemented minimum flexural reinforcement condition. Until those conditions are met, the usable value and demand utilization remain null and an entered moment demand receives a review status. No exception is inferred from self-weight alone. The corresponding workbook uses a separately gated capacity at `Structure!C60`; demand outputs at C57/C69 and `Summary!D38` consume it, while C42 remains an intermediate.

### R2-02: the two reinforcement faces could overlap vertically

**Baseline locations:** `projects/s6006/engineering.js`, `validateBeamInputs`, geometry checks; `engineering-ui.js`, the BF1 two-face section illustration; workbook `Structure!C24`.

The drawing and illustration show top and bottom reinforcement. The baseline checked the single tension-face effective depth and horizontal fit but did not enforce vertical fit for both faces.

Engine reproduction, with other default fields unchanged:

```js
{
  heightMm: 150,
  coverMm: 65,
  stirrupSpacingMm: 18,
  externalMuKnM: 3,
  externalVuKn: 1
}
```

The inner stirrup height is only 150 - 2(65 + 6) = 8 mm, less than one 12 mm bar diameter, yet the baseline accepted the geometry and evaluable strength checks. A workbook reproduction with h = 150 mm and cover = 70 mm likewise produced d = 68 mm and a numerical moment capacity despite impossible bar placement.

**Implemented correction:** enforce the chosen symmetric two-face arrangement with

`h >= 2(cover + stirrup diameter + longitudinal bar diameter) + max(25 mm, longitudinal bar diameter)`.

This is a geometric applicability gate for the arrangement represented by this module. It does not add compression-steel credit or claim to check all construction detailing. The 150/70 mm workbook example requires at least 201 mm under this gate.

### R2-03: accepted finite inputs could produce nonfinite outputs

**Baseline locations:** `projects/s6006/engineering.js`, `validateSoilInputs` and the FS division in `calculateSoil`; JSON export in `engineering-ui.js`.

The following input passes baseline validation but returns `Infinity` for both FS values:

```js
{
  ...DEFAULT_SOIL_INPUTS,
  verticalDepthM: 1e-310,
  effectiveCohesionKpa: 1
}
```

The driving shear is approximately 6.8965517241379e-310 kPa, so the strength-to-demand ratio overflows. An undrained example with the same depth and Su = 30 kPa also overflows. `JSON.stringify` serializes a nonfinite number as null, making this failure look like absent information in an exported scenario. These extreme inputs do not affect the normal default examples, but they expose a gap in the accepted numerical domain.

**Implemented correction:** reject nonfinite calculated outputs and invalid driving denominators with an explicit calculation error. Focused tests cover the relevant numerical boundary, explicit errors, and prevention of silently converted nonfinite scenario results. The engine uses the minimum normal IEEE-754 value (2^-1022) as a numerical divisor boundary, not as an engineering acceptance criterion.

### R2-04: workbook notes and type guards could disagree with live calculations

**Confirmed workbook locations:** `Summary!E38`, E39 and E40; `Structure!B78` and C24.

- E38/E39 and B78 contained fixed descriptions of the default As/Av shortcomings. Changing `Structure!C10` to 8 and C11 to 16 gives passing C64/C66 checks and C51 = C50 = 102.36099 kN in the reviewed workbook, while those fixed notes still said the reinforcement failed or that capacity was reduced.
- `Summary!E40` repeated gamma = 20, phi = 32, c = 0 and z = 2 alongside results that could be recalculated from different inputs. Source facts and current adopted values need distinct labels.
- In the authoring runtime, setting `Structure!C15` to the text value `"210"` still satisfied the reviewed C24 guard `COUNT(C7:C20)=14` and produced a capacity, whereas `ISNUMBER` correctly rejects that text value. An isolated runtime reproduction returned ISNUMBER = false but COUNT of the referenced cell = 1. Reliance on COUNT therefore did not enforce the intended typed-input contract consistently. [Microsoft's COUNT documentation](https://support.microsoft.com/en-us/excel/functions/count-function?nochrome=true) distinguishes text in a referenced range from numerical arguments.

**Implemented correction:** derive status notes from the current input/check cells, retain source values as explicitly identified defaults or evidence, and use explicit `ISNUMBER` predicates for numerical inputs. Mirror the two-face geometric gate and usable moment-capacity gate. Artifact export/reimport, representative changed-input checks, error scanning, and visual review were completed. `Summary!D42` now displays the active total-stress example; inactive stress-model results remain blank. The delivered workbook restores the default inputs and leaves actual Mu, Vu, and Su blank.

### R2-05: stale blank-handling metadata

**Baseline location:** `projects/s6006/source-data.json`, `blankPolicy` at line 88.

The text said that the arithmetic audit used blank = 0, while the live engine and `auditPolicy` already preserved unknown inputs as null and incomplete. The metadata has been edited to distinguish blank handling in original workbook formulas from the application's strict unknown-input policy. No numeric source cell, formula, quantity definition, or engine calculation was changed by this correction.

## Soil equations and parameter interpretation confirmed at baseline

The source table on calculation PDF p16 reports gamma = 20 kN/m³ and phi = 32 degrees for `Sand, Filled`. Its cohesion entry is a dash; the table does not specify effective-stress test parameters or a drainage/test basis. The source clay cohesion values 30, 90 and 500 kPa are not automatically converted to c-prime or Su.

The default example explicitly adopts the sand phi value as phi-prime and uses gamma = 20 for the dry case as assumptions. It additionally assumes c-prime = 0 kPa, gamma-saturated = 20 kN/m³, vertical z = 2 m, and gamma-water = 9.80665 kN/m³. These adopted assumptions are not newly verified material properties.

For beta = atan(1 / 2.5), the implemented stress equations are:

- Total normal stress: `sigma = gamma z cos²(beta)`.
- Driving shear: `tau = gamma z sin(beta) cos(beta)`.
- Effective strength: `tau_f = c-prime + (sigma - u) tan(phi-prime)`.
- Fully saturated parallel seepage: `u = gamma-water z cos²(beta)`, with the free surface at the slope surface and no external water support.
- Undrained total stress: `tau_f = Su`; pore pressure is not subtracted from Su again. Reported u and effective normal stress are null in this mode rather than asserted to be zero.

These equations and the source interpretation do not require a change in this review. Under the default assumptions the dry FS is approximately **1.562173** and the saturated parallel-seepage FS is approximately **0.796189**. They describe the selected shallow homogeneous mechanism and are not global S6006 FS values or rapid-drawdown results. The numerical guard preserves these defaults in regression checks.

The reported Slope/W results remain external evidence: existing bank 3.378 against the report's 1.3 criterion on PDF p16; designed bank 2.588 against 1.5 on pp16-17; rapid drawdown 2.164 against 1.3 on p17. No native Slope/W model or full slip-surface search was reconstructed. Allowing a cohesive or undrained selected parallel plane does not establish that it is the governing failure surface of a real slope.

## Quantity reconciliation confirmed at baseline

The independent source audit compared **1,190 numeric source-cell references, representing 1,156 distinct cells**, in the application extraction against the original XLSX XML. It found **zero numeric mismatches**. Source input and cached-product entries marked null were also checked for unexpected numeric XML values; none were found. These counts describe the selected extraction, not every cell or formula in the workbook.

The selected scope contains **41 station rows and 13 component definitions**: rows 14-25 provide 12 rows and 286 m; rows 104-132 provide 29 rows and 714 m. The total is 1,000 m. The legacy 222 m block and subsequent station rows with missing effective length are excluded. Original second-reach allowance formulas also use `$F$7 = 0.30`; the common depth reference in the adapter is consistent with those formulas.

| Aggregate | Original adopted quantity | Recomputed known quantity after separate reach rounding | Input completeness |
|---|---:|---:|---|
| Excavation | 19,417 m³ | 19,417 m³ | Complete |
| Rock toe with reported end closures | 32,840 m³ | 32,840 m³ | 1 missing input |
| Front sand fill | 148,206 m³ | 148,206 m³ | 1 missing input |
| Front geotextile with reported end closures | 40,035 m² | 40,985 m² | Inputs complete; original T25 product missing |
| Riprap before stair deductions | 17,295 m³ | 17,295 m³ | 41 missing slope-adjustment inputs |
| Back sand fill | 0 m³ in source | Unknown | 82 missing inputs |
| Earth fill | 1,694 m³ | 2,566 m³ | 2 missing inputs; 8 missing original products |

The T25 product is 40.425 × 23.5 = 949.9875 m². Its effect after source-style separate reach rounding is 950 m². The seven newly computable earth-fill products total 871.725 m³; separate reach rounding produces a known-quantity difference of 872 m³. These differences are correct rounding effects, not new arithmetic defects. Unknown source values must not be filled with zero to make these partial sums appear complete.

The 17,037 m³ net riprap value remains a reported source amount, derived from adopted 17,295 less stair deductions of 86 and 172 m³. `สรุปปริมาณงาน!F202` remains blank, so the application does not validate all downstream deductions. Reported end closures are preserved source additions, not newly measured geometry.

No changes to the station-integration equations or per-reach rounding are requested. Geometry and visualization continue to use matching perpendicular-thickness strips and an explicitly assumed symmetric toe with a flat base. The theoretical component envelopes do not include surveyed terrain, joint-overlap deductions, or a validated net project quantity. Negative station quantities and incompatible dimensions are rejected; CSV station export preserves unknown computed values and their statuses.

## Completion record

The integrated calculation and interface changes were verified at implementation commit [`9049c109c1b7f9ec946c7f90f02a3592d605fc7c`](https://github.com/saratchai1/riverbank-dam-types/commit/9049c109c1b7f9ec946c7f90f02a3592d605fc7c). [Actions run 44882900379](https://github.com/saratchai1/riverbank-dam-types/actions/runs/44882900379) completed successfully. This final record is a documentation-only follow-up; its commit does not alter those calculations or outputs.

| Gate | Verified evidence | Status |
|---|---|---|
| Integrated software | 67 unit tests and JavaScript syntax checks passed at the implementation commit above | Complete |
| Usable moment capacity | Default Mu = 30 kN·m returns review with no usable moment capacity or utilization; an adequately reinforced case can compare demand and capacity | Complete |
| Vertical two-face bar fit | Engine and workbook reject the cited impossible sections and retain valid default geometry | Complete |
| Finite numerical results | Tiny-depth, subnormal denominator, and overflow reproductions produce explicit calculation errors; nonfinite values cannot be accepted as computed scenario outputs | Complete |
| Soil regression | Default dry FS = 1.5621733798 and parallel-seepage FS = 0.7961890010 retained; independent 45-degree case gives 1.5/1.0; total-stress Su = 30 kPa case gives 2.175 without subtracting pore pressure twice | Complete |
| Quantity regression | 1,190 numeric references / 1,156 distinct original XLSX cells match; scope, numeric source values, source formulas, known sums, unknown statuses and separate reach rounding retained | Complete |
| Browser and report | 19 browser test groups passed; no browser page, console or local-request errors; all 20 report pages passed layout/text checks; affected structural/soil PDF pages 9-14, references and desktop/mobile engineering screens visually inspected | Complete |
| Workbook edited inputs | Builder checks: 50 base, 54 engineering and 15 edited-input checks; independent fresh-import checks: 44 scenarios and 152 assertions, all passed | Complete |
| Workbook saved-file verification | 7 sheets, 4,210 formulas, 3,213 numeric formula caches and 412 intentional blank formula results; no error cells or nonfinite numeric results; affected sheets and reinforced/undrained summary states visually inspected | Complete |
| Workbook quantities retained | Values, formulas and cell types in Typical, Reach, Takeoff, Source and Summary rows 1-35 match the previous deliverable | Complete |
| Final inputs and workbook identity | R2 workbook with default inputs restored; actual Mu, Vu and Su remain blank; fingerprint below | Complete |

### Artifact identity

- Calculation revision in scenario exports and the report: **S6006-R2**.
- Workbook build file: **`S6006-engineering-calculations-R2.xlsx`**; the existing delivery link retains the name `S6006-engineering-calculations.xlsx` when replaced with this version.
- Workbook SHA-256: **`b424faf88c117f7703f8af5196827165ed894cfc5052bcc4bd51edb10d347bdb`**.
- Companion workbook guide: `validation-and-use-R2.md`.
- Workbook evidence: `validation.json`, `engineering-validation.json`, `independent-r2-validation.json`, and `export-validation.json`.
- Browser/report evidence: artifact `browser-evidence-44882900379-1`, including `browser-report.json`, `s6006-report-page-metrics.json`, and the 20-page calculation PDF.
- The delivery manifest distinguishes build-file fingerprints from any storage-normalized PDF fingerprint. Text and rendered content are compared when PDF bytes change during storage.

### Limits retained after correction

Workbook recalculation, changed-input checks and rendering were performed with artifact-tool, plus direct XLSX XML inspection and fresh reimport. This is not a complete native Microsoft Excel recalculation of every scenario. The COUNT behavior reported above was observed in the authoring runtime, not asserted to be Microsoft Excel behavior; explicit ISNUMBER guards remove that ambiguity.

The implemented capacities apply only within the selected historical calculation basis and the stated model. Actual structural system actions and combinations, cover, anchorage, lap and development lengths, full reinforcement detailing, piles and their interaction with soil still require project-specific design information. The infinite-slope examples require verified material parameters and water conditions and do not replace global stability, settlement, seepage, erosion or rapid-drawdown analyses. The app must retain unknown or review statuses where those inputs or checks are absent.

Passing these numerical and software gates does not certify the constructed project, validate every original source assumption, or establish full current-code compliance. No source document was modified to make it agree with the demo.
