CLERICAL EMPLOYEE OF THE MONTH VOTING SYSTEM

1. Run the Supabase SQL script supplied in the ChatGPT conversation.
2. Open config.js.
3. Replace SUPABASE_URL with your Supabase Project URL.
4. Replace SUPABASE_ANON_KEY with your Supabase anon/public key.
5. Upload index.html, style.css, app.js, and config.js to your web host.
6. Create users in Supabase Authentication.
7. Make sure each user's login email matches the email in the employees table.
8. Set your own profile role to admin in the profiles table.

EMPLOYEE IMPORT COLUMNS
- employee_number
- first_name
- last_name
- email
- school_department
- job_title
- eligible_to_vote
- eligible_for_award
- active

The import accepts CSV, XLSX, and XLS files.
