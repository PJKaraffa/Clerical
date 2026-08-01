CLERICAL EMPLOYEE OF THE MONTH — VERSION 2

FILES
- index.html
- style.css
- app.js
- config.js
- SQL_UPDATE_NOMINATION_REASON.sql

INSTALLATION
1. Replace the matching files in your GitHub Clerical repository.
2. Keep your real Supabase URL and anon key in config.js.
3. Run SQL_UPDATE_NOMINATION_REASON.sql once if nomination_reason has not been added.
4. Commit the files and wait for GitHub Pages to deploy.
5. In Chrome, press Ctrl+F5.

ROLE BEHAVIOR
- voter: can only see the Vote screen.
- admin: can see Vote and Admin Dashboard.
- Admin subpages are hidden unless their tab is selected.
- Signing out resets all protected screens before the next login.

DATABASE ROLES
The profiles.role field must contain either:
- admin
- voter

LIVE RESULTS
Administrators can open Admin Dashboard > Results to see the current leader,
rank, votes, and vote share. Voters cannot access this information.
