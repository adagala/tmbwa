# Authorization matrix

Firestore Security Rules are the authorization boundary. Interface visibility is not authorization.

| Resource | Administrator | Member | Unauthenticated |
| --- | --- | --- | --- |
| Member documents | Read, list, create, update, delete | Read own; update approved own profile fields | None |
| Contributions | Read; write through trusted Functions | Read own | None |
| Payments | Read; write through trusted Functions | Read own | None |
| Monthly/global statistics | Read; write through trusted Functions | None | None |
| Unknown collections | None unless explicitly added | None | None |

Members may update only their own first name, last name, admission number, welfare identification number, phone number, and gender. They cannot change email, role, status, balances, fees, identifiers, search indexes, timestamps, or financial records.

Administrative access depends on the Firebase Auth custom claim `role: administrator`. Backend operations using the Admin SDK bypass Firestore Security Rules and must perform their own authorization and input validation.

Balances, contribution balances, contributions, payments, and monthly statistics are server-owned. Even administrators cannot write these fields directly through the client SDK; they must use the callable financial commands.
