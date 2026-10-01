# Frontend shared-component audit

Issue #41 audit completed on 2026-08-20. Application pages, sections, and feature components now use the shared primitives in `src/components`.

| Area                                                    | Native UI found                                                          | Shared replacement                            | Status   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- | -------- |
| `sections/transactions.tsx`                             | receipt button                                                           | `Button`                                      | Complete |
| `sections/contributionsAndTansactions.tsx`              | date labels, date inputs, statement button                               | `Label`, `Input`, `Button`                    | Complete |
| `app/main/AuditPage.tsx`                                | pagination button                                                        | `Button`                                      | Complete |
| `app/main/KcbReconciliationPage.tsx`                    | contribution/member selects, amount inputs, remove/retry buttons, labels | `Select`, `Input`, `Button`, `Label`          | Complete |
| `app/main/ReportPage.tsx`                               | month inputs, filter selects, labels, export button, results table       | `Input`, `Select`, `Label`, `Button`, `Table` | Complete |
| `components/ui/members/DialogMemberStatus.tsx`          | status select                                                            | `Select`, `Label`                             | Complete |
| `components/ui/navigation/SidebarWorkspaceDropdown.tsx` | trigger buttons                                                          | `Button`                                      | Complete |
| `app/main/OverviewPage.tsx`                              | direct Tremor list import                                                 | `List`, `ListItem`                             | Complete |
| `app/main/ContributionsPage.tsx`                         | direct Tremor list import                                                 | `List`, `ListItem`                             | Complete |
| `sections/contributions.tsx`                             | direct Tremor list import                                                 | `List`, `ListItem`                             | Complete |
| `sections/transactions.tsx`                              | direct Tremor list import                                                 | `List`, `ListItem`                             | Complete |

`src/components/Table.tsx` was added from the official [Tremor Table v1.0.0](https://www.tremor.so/docs/ui/table), accessed 2026-08-20. `src/components/List.tsx` provides the application boundary for the official [Tremor List and ListItem](https://npm.tremor.so/docs/ui/list), accessed 2026-08-20. Native elements and vendor imports inside top-level `src/components/*.tsx` files are intentional implementation details of the shared primitives. Semantic layout and form elements remain native.

Run `npm run lint:ui-components` to verify that application code does not introduce native controls or direct Tremor imports outside the shared primitive boundary.
