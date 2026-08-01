'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  profile: null,
  currentEmployee: null,
  currentElection: null,
  candidates: [],
  selectedCandidate: null,
  existingVote: null,
  employees: [],
  participation: [],
  results: [],
  votes: [],
  elections: [],
  importRows: []
};

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];

function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = 'toast', 3500);
}

function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {})
  }).format(date);
}

function formatMonth(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
}

function candidateName(candidate) {
  return `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim();
}

function setLoading(button, loading, loadingText = 'Working...') {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function initialize() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR-PROJECT')) {
    $('loginMessage').textContent = 'Add your Supabase URL and anon key in config.js before signing in.';
  }

  bindEvents();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) await startApp(session);

  supabaseClient.auth.onAuthStateChange(async (_event, sessionNow) => {
    if (sessionNow && !state.session) await startApp(sessionNow);
    if (!sessionNow) showLogin();
  });
}

function bindEvents() {
  $('loginForm').addEventListener('submit', login);
  $('logoutButton').addEventListener('click', logout);
  $('candidateSelect').addEventListener('change', handleCandidateSelection);
  $('nominationReason').addEventListener('input', updateReasonCount);
  $('finalVoteConfirmation').addEventListener('change', updateReviewButton);
  $('reviewVoteButton').addEventListener('click', openVoteModal);
  $('submitVoteButton').addEventListener('click', submitVote);
  $('refreshAdminButton').addEventListener('click', loadAdminDashboard);
  $('electionForm').addEventListener('submit', createElection);
  $('loadCandidatesButton').addEventListener('click', loadMonthlyCandidates);
  $('openElectionButton').addEventListener('click', () => changeElectionStatus('open'));
  $('closeElectionButton').addEventListener('click', () => changeElectionStatus('closed'));
  $('finalizeWinnerButton').addEventListener('click', finalizeWinner);
  $('employeeFileInput').addEventListener('change', previewEmployeeFile);
  $('importEmployeesButton').addEventListener('click', importEmployees);
  $('employeeForm').addEventListener('submit', saveEmployee);
  $('clearEmployeeFormButton').addEventListener('click', clearEmployeeForm);
  $('employeeSearch').addEventListener('input', renderEmployeeTable);
  $('exportParticipationButton').addEventListener('click', exportParticipation);
  $('exportResultsButton').addEventListener('click', exportResults);
  $('saveVoteCorrectionButton').addEventListener('click', saveVoteCorrection);

  $$('.tab').forEach(button => button.addEventListener('click', () => switchMainPage(button.dataset.page)));
  $$('.admin-tab').forEach(button => button.addEventListener('click', () => switchAdminView(button.dataset.adminView)));
  $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
}

async function login(event) {
  event.preventDefault();
  const button = $('loginButton');
  setLoading(button, true, 'Signing In...');
  $('loginMessage').textContent = '';
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: $('loginEmail').value.trim(),
      password: $('loginPassword').value
    });
    if (error) throw error;
  } catch (error) {
    $('loginMessage').textContent = error.message;
  } finally {
    setLoading(button, false);
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  resetApplicationState();
  showLogin();
}

function resetApplicationState() {
  state.session = null;
  state.profile = null;
  state.currentEmployee = null;
  state.currentElection = null;
  state.candidates = [];
  state.selectedCandidate = null;
  state.existingVote = null;
  state.employees = [];
  state.participation = [];
  state.results = [];
  state.votes = [];
  state.elections = [];
  state.importRows = [];

  // Always reset the interface to the Vote page before another user logs in.
  forceVotePage();
}

function showLogin() {
  $('loginPage').classList.remove('hidden');
  $('appShell').classList.add('hidden');
  forceVotePage();
}

function isAdmin() {
  return state.profile?.role === 'admin';
}

function forceVotePage() {
  $$('.page').forEach(page => page.classList.add('hidden'));
  $('votePage')?.classList.remove('hidden');

  $$('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.page === 'votePage');
  });
}

function applyRoleAccess() {
  const admin = isAdmin();

  // Hide every administrator-only control from voters.
  $$('.admin-only').forEach(element => {
    element.classList.toggle('hidden', !admin);
  });

  // A voter must never remain on an administrator screen left open by
  // a previous administrator session in the same browser.
  if (!admin) {
    forceVotePage();
    $('adminPage')?.classList.add('hidden');
  }
}

async function startApp(session) {
  state.session = session;
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('*, employees(*)')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    showToast('Your user profile could not be loaded. Ask an administrator to connect your account.', true);
    await logout();
    return;
  }

  state.profile = profile;
  state.currentEmployee = profile.employees || null;
  $('headerUserName').textContent = profile.full_name || session.user.email;
  $('headerUserRole').textContent = profile.role === 'admin' ? 'Administrator' : 'Voter';
  $('loginPage').classList.add('hidden');
  $('appShell').classList.remove('hidden');

  // Apply permissions and force every newly authenticated user to begin
  // on the Vote page. This prevents a voter from inheriting an admin page
  // that was open before sign-out.
  applyRoleAccess();
  forceVotePage();

  await loadVoterPage();
  if (isAdmin()) await loadAdminDashboard();
}

function switchMainPage(pageId) {
  // Front-end guard: voters cannot open the Admin Dashboard.
  if (pageId === 'adminPage' && !isAdmin()) {
    forceVotePage();
    showToast('Administrator access is required.', true);
    return;
  }

  const targetPage = $(pageId);
  if (!targetPage) return;

  $$('.page').forEach(page => page.classList.add('hidden'));
  targetPage.classList.remove('hidden');
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.page === pageId));
}

function switchAdminView(viewId) {
  if (!isAdmin()) {
    forceVotePage();
    showToast('Administrator access is required.', true);
    return;
  }
  $$('.admin-view').forEach(view => view.classList.add('hidden'));
  $(viewId).classList.remove('hidden');
  $$('.admin-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.adminView === viewId));
}

async function loadVoterPage() {
  state.selectedCandidate = null;
  state.existingVote = null;
  $('ballotPanel').classList.add('hidden');
  $('voteAlreadySubmitted').classList.add('hidden');
  $('noElectionPanel').classList.add('hidden');

  const now = new Date().toISOString();
  const { data: elections, error } = await supabaseClient
    .from('voting_periods')
    .select('*')
    .eq('status', 'open')
    .lte('opens_at', now)
    .gte('closes_at', now)
    .order('voting_month', { ascending: false })
    .limit(1);

  if (error) return showToast(error.message, true);
  state.currentElection = elections?.[0] || null;

  if (!state.currentElection) {
    $('electionTitle').textContent = 'Employee of the Month';
    $('electionStatusText').textContent = 'There is no active voting period.';
    $('countdownCard').classList.add('hidden');
    $('noElectionPanel').classList.remove('hidden');
    return;
  }

  $('electionTitle').textContent = `${state.currentElection.election_name} — ${formatMonth(state.currentElection.voting_month)}`;
  $('electionStatusText').textContent = `Voting is open through ${formatDate(state.currentElection.closes_at)}.`;
  $('countdownCard').classList.remove('hidden');
  updateCountdown();

  const { data: vote } = await supabaseClient
    .from('votes')
    .select('*, employees:candidate_employee_id(first_name,last_name,school_department,job_title)')
    .eq('voting_period_id', state.currentElection.id)
    .eq('voter_id', state.session.user.id)
    .maybeSingle();

  if (vote) {
    state.existingVote = vote;
    $('submittedVoteText').textContent = `You selected ${candidateName(vote.employees)} on ${formatDate(vote.submitted_at)}.`;
    $('voteAlreadySubmitted').classList.remove('hidden');
    return;
  }

  const { data: rows, error: candidateError } = await supabaseClient
    .from('election_candidates')
    .select('employee_id, employees(*)')
    .eq('voting_period_id', state.currentElection.id)
    .eq('active', true);

  if (candidateError) return showToast(candidateError.message, true);
  state.candidates = (rows || []).map(row => row.employees).filter(Boolean)
    .filter(employee => employee.id !== state.currentEmployee?.id)
    .sort((a,b) => a.last_name.localeCompare(b.last_name));

  state.selectedCandidate = null;
  $('nominationReason').value = '';
  $('finalVoteConfirmation').checked = false;
  updateReasonCount();
  renderCandidates();
  $('ballotPanel').classList.remove('hidden');
}

function updateCountdown() {
  if (!state.currentElection) return;
  const diff = new Date(state.currentElection.closes_at) - new Date();
  if (diff <= 0) {
    $('countdownText').textContent = 'Closed';
    return;
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  $('countdownText').textContent = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}
setInterval(updateCountdown, 60000);

function renderCandidates() {
  const select = $('candidateSelect');
  const currentValue = state.selectedCandidate ? String(state.selectedCandidate.id) : '';
  select.innerHTML = '<option value="">Select an employee...</option>' + state.candidates.map(employee => {
    const detail = [employee.school_department, employee.job_title].filter(Boolean).join(' — ');
    return `<option value="${employee.id}">${escapeHtml(candidateName(employee))}${detail ? ` — ${escapeHtml(detail)}` : ''}</option>`;
  }).join('');
  select.value = currentValue;
  updateCandidateDetails();
  updateReviewButton();
}

function handleCandidateSelection() {
  const id = Number($('candidateSelect').value);
  state.selectedCandidate = id ? state.candidates.find(candidate => candidate.id === id) || null : null;
  updateCandidateDetails();
  updateReviewButton();
}

function updateCandidateDetails() {
  const candidate = state.selectedCandidate;
  $('candidateDetails').classList.toggle('hidden', !candidate);
  if (!candidate) {
    $('selectedCandidateSummary').textContent = 'No employee selected';
    $('selectedCandidateSummary').classList.add('muted');
    return;
  }
  const initials = `${candidate.first_name?.[0] || ''}${candidate.last_name?.[0] || ''}`.toUpperCase();
  $('candidateInitials').textContent = initials || '--';
  $('candidateDetailName').textContent = candidateName(candidate);
  $('candidateDetailTitle').textContent = candidate.job_title || 'Clerical Employee';
  $('candidateDetailDepartment').textContent = candidate.school_department || 'Bridgeport Public Schools';
  $('selectedCandidateSummary').textContent = `Selected: ${candidateName(candidate)}`;
  $('selectedCandidateSummary').classList.remove('muted');
}

function updateReasonCount() {
  $('reasonCharacterCount').textContent = $('nominationReason').value.length;
}

function updateReviewButton() {
  $('reviewVoteButton').disabled = !(state.selectedCandidate && $('finalVoteConfirmation').checked);
}

function openVoteModal() {
  if (!state.selectedCandidate) return;
  $('voteModalCandidate').innerHTML = `<strong>${escapeHtml(candidateName(state.selectedCandidate))}</strong><br><span>${escapeHtml(state.selectedCandidate.job_title || '')}</span><br><span>${escapeHtml(state.selectedCandidate.school_department || '')}</span>`;
  const reason = $('nominationReason').value.trim();
  $('voteModalReason').classList.toggle('hidden', !reason);
  $('voteModalReason').innerHTML = reason ? `<strong>Reason for nomination</strong><p>${escapeHtml(reason)}</p>` : '';
  $('voteModal').classList.remove('hidden');
}

function closeModal(id) { $(id).classList.add('hidden'); }

async function submitVote() {
  if (!state.selectedCandidate || !state.currentElection) return;
  const button = $('submitVoteButton');
  setLoading(button, true, 'Submitting...');
  try {
    const { error } = await supabaseClient.from('votes').insert({
      voting_period_id: state.currentElection.id,
      voter_id: state.session.user.id,
      candidate_employee_id: state.selectedCandidate.id,
      nomination_reason: $('nominationReason').value.trim() || null
    });
    if (error) throw error;
    closeModal('voteModal');
    showToast('Your vote was submitted successfully.');
    await loadVoterPage();
    if (state.profile.role === 'admin') await loadAdminDashboard();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setLoading(button, false);
  }
}

async function loadAdminDashboard() {
  if (!isAdmin()) {
    forceVotePage();
    return;
  }
  const [employeesResult, electionsResult] = await Promise.all([
    supabaseClient.from('employees').select('*').order('last_name'),
    supabaseClient.from('voting_periods').select('*, winner:winner_employee_id(first_name,last_name)').order('voting_month', { ascending: false })
  ]);

  if (employeesResult.error) return showToast(employeesResult.error.message, true);
  if (electionsResult.error) return showToast(electionsResult.error.message, true);

  state.employees = employeesResult.data || [];
  state.elections = electionsResult.data || [];
  if (!state.currentElection || !state.elections.some(e => e.id === state.currentElection.id)) {
    state.currentElection = state.elections.find(e => ['open','closed','draft'].includes(e.status)) || state.elections[0] || null;
  } else {
    state.currentElection = state.elections.find(e => e.id === state.currentElection.id) || state.currentElection;
  }

  renderEmployeeTable();
  renderElectionDetails();
  renderHistory();
  await loadElectionAdminData();
}

async function loadElectionAdminData() {
  if (!state.currentElection) {
    state.participation = []; state.results = []; state.votes = [];
    renderParticipation(); renderResults(); renderVotes(); updateMetrics();
    return;
  }

  const [participationResult, resultsResult, votesResult, candidatesResult] = await Promise.all([
    supabaseClient.from('monthly_voter_participation').select('*').eq('voting_period_id', state.currentElection.id).order('last_name'),
    supabaseClient.from('monthly_vote_results').select('*').eq('voting_period_id', state.currentElection.id).order('result_rank'),
    supabaseClient.from('votes').select('*, voter:profiles!votes_voter_id_fkey(full_name,email), candidate:candidate_employee_id(first_name,last_name)').eq('voting_period_id', state.currentElection.id).order('submitted_at'),
    supabaseClient.from('election_candidates').select('employee_id, employees(*)').eq('voting_period_id', state.currentElection.id).eq('active', true)
  ]);

  state.participation = participationResult.data || [];
  state.results = resultsResult.data || [];
  state.votes = votesResult.data || [];
  state.candidates = (candidatesResult.data || []).map(row => row.employees).filter(Boolean);

  renderParticipation(); renderResults(); renderVotes(); updateMetrics();
}

function renderElectionDetails() {
  const container = $('currentElectionAdmin');
  if (!state.currentElection) {
    container.innerHTML = '<p class="muted">No election has been created.</p>';
    return;
  }
  container.innerHTML = `
    <div class="detail-row"><span>Month</span><strong>${escapeHtml(formatMonth(state.currentElection.voting_month))}</strong></div>
    <div class="detail-row"><span>Status</span><strong>${escapeHtml(state.currentElection.status.toUpperCase())}</strong></div>
    <div class="detail-row"><span>Opens</span><strong>${escapeHtml(formatDate(state.currentElection.opens_at))}</strong></div>
    <div class="detail-row"><span>Closes</span><strong>${escapeHtml(formatDate(state.currentElection.closes_at))}</strong></div>`;
}

function updateMetrics() {
  const eligible = state.participation.length;
  const submitted = state.participation.filter(row => row.has_voted).length;
  $('metricEligibleVoters').textContent = eligible;
  $('metricVotesSubmitted').textContent = submitted;
  $('metricParticipation').textContent = eligible ? `${Math.round(submitted / eligible * 100)}%` : '0%';
  $('metricCandidates').textContent = state.results.length || state.candidates.length;
}

function renderParticipation() {
  $('participationTableBody').innerHTML = state.participation.length ? state.participation.map(row => `
    <tr><td><strong>${escapeHtml(`${row.first_name} ${row.last_name}`)}</strong></td><td>${escapeHtml(row.school_department || '—')}</td><td><span class="status-pill ${row.has_voted ? 'status-green' : 'status-gray'}">${row.has_voted ? 'Voted' : 'Not Voted'}</span></td><td>${row.submitted_at ? escapeHtml(formatDate(row.submitted_at)) : '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No participation records available.</td></tr>';
}

function renderResults() {
  const totalVotes = state.results.reduce((sum,row) => sum + Number(row.vote_count || 0), 0);
  $('resultsTableBody').innerHTML = state.results.length ? state.results.map(row => `
    <tr><td><strong>#${row.result_rank}</strong></td><td>${escapeHtml(`${row.first_name} ${row.last_name}`)}</td><td>${escapeHtml(row.school_department || '—')}</td><td><strong>${row.vote_count}</strong></td><td>${totalVotes ? (row.vote_count / totalVotes * 100).toFixed(1) : '0.0'}%</td></tr>`).join('') : '<tr><td colspan="5" class="muted">No candidate results are available.</td></tr>';

  const leaders = state.results.filter(row => row.result_rank === 1 && Number(row.vote_count) > 0);
  const banner = $('leaderBanner');
  if (leaders.length) {
    banner.classList.remove('hidden');
    banner.innerHTML = leaders.length > 1
      ? `<strong>Current tie:</strong> ${leaders.map(row => escapeHtml(`${row.first_name} ${row.last_name}`)).join(', ')} with ${leaders[0].vote_count} votes each.`
      : `<strong>Current leader:</strong> ${escapeHtml(`${leaders[0].first_name} ${leaders[0].last_name}`)} with ${leaders[0].vote_count} votes.`;
  } else banner.classList.add('hidden');
}

function renderVotes() {
  $('votesTableBody').innerHTML = state.votes.length ? state.votes.map(vote => `
    <tr><td>${escapeHtml(vote.voter?.full_name || vote.voter?.email || vote.voter_id)}</td><td>${escapeHtml(candidateName(vote.candidate || {}))}</td><td>${escapeHtml(formatDate(vote.submitted_at))}</td><td><div class="button-row"><button class="btn btn-light edit-vote" data-vote-id="${vote.id}" type="button">Change</button><button class="btn btn-danger delete-vote" data-vote-id="${vote.id}" type="button">Delete</button></div></td></tr>`).join('') : '<tr><td colspan="4" class="muted">No votes have been submitted.</td></tr>';
  $$('.edit-vote').forEach(button => button.addEventListener('click', () => openVoteCorrection(Number(button.dataset.voteId))));
  $$('.delete-vote').forEach(button => button.addEventListener('click', () => deleteVote(Number(button.dataset.voteId))));
}

function renderHistory() {
  $('historyTableBody').innerHTML = state.elections.length ? state.elections.map(election => `
    <tr><td>${escapeHtml(formatMonth(election.voting_month))}</td><td>${escapeHtml(election.election_name)}</td><td><span class="status-pill status-blue">${escapeHtml(election.status)}</span></td><td>${election.winner ? escapeHtml(candidateName(election.winner)) : '—'}</td><td>${election.finalized_at ? escapeHtml(formatDate(election.finalized_at)) : '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">No election history available.</td></tr>';
}

async function createElection(event) {
  event.preventDefault();
  const monthValue = $('votingMonth').value;
  if (!monthValue) return;
  const payload = {
    election_name: $('electionName').value.trim(),
    voting_month: `${monthValue}-01`,
    opens_at: new Date($('opensAt').value).toISOString(),
    closes_at: new Date($('closesAt').value).toISOString(),
    status: $('electionStatus').value,
    created_by: state.session.user.id
  };
  const { data, error } = await supabaseClient.from('voting_periods').insert(payload).select().single();
  if (error) return showToast(error.message, true);
  state.currentElection = data;
  showToast('Monthly election created.');
  await loadAdminDashboard();
  await loadVoterPage();
}

async function loadMonthlyCandidates() {
  if (!state.currentElection) return showToast('Create an election first.', true);
  const { data, error } = await supabaseClient.rpc('load_monthly_candidates', { p_voting_period_id: state.currentElection.id });
  if (error) return showToast(error.message, true);
  showToast(`${data} eligible candidates added.`);
  await loadElectionAdminData();
}

async function changeElectionStatus(status) {
  if (!state.currentElection) return showToast('No election selected.', true);
  const { error } = await supabaseClient.from('voting_periods').update({ status }).eq('id', state.currentElection.id);
  if (error) return showToast(error.message, true);
  showToast(`Election status changed to ${status}.`);
  await loadAdminDashboard();
  await loadVoterPage();
}

async function finalizeWinner() {
  if (!state.currentElection) return showToast('No election selected.', true);
  const { data, error } = await supabaseClient.rpc('finalize_monthly_winner', { p_voting_period_id: state.currentElection.id });
  if (error) return showToast(error.message, true);
  const winner = state.employees.find(employee => employee.id === data);
  showToast(`Winner finalized: ${winner ? candidateName(winner) : 'Employee'}.`);
  await loadAdminDashboard();
}

async function previewEmployeeFile(event) {
  const file = event.target.files?.[0];
  state.importRows = [];
  $('importEmployeesButton').disabled = true;
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    state.importRows = raw.map(normalizeEmployeeRow).filter(row => row.employee_number && row.first_name && row.last_name);
    $('importPreview').innerHTML = `<strong>${state.importRows.length}</strong> valid employee rows ready to import.<br><small>Existing employee numbers will be updated.</small>`;
    $('importEmployeesButton').disabled = state.importRows.length === 0;
  } catch (error) {
    showToast(`Could not read file: ${error.message}`, true);
  }
}

function normalizeEmployeeRow(row) {
  const lower = Object.fromEntries(Object.entries(row).map(([key,value]) => [key.trim().toLowerCase().replace(/\s+/g,'_'), value]));
  const bool = (value, fallback = true) => value === '' ? fallback : ['true','yes','1','y'].includes(String(value).trim().toLowerCase());
  return {
    employee_number: String(lower.employee_number || lower.employee_id || lower.id || '').trim(),
    first_name: String(lower.first_name || lower.firstname || '').trim(),
    last_name: String(lower.last_name || lower.lastname || '').trim(),
    email: String(lower.email || '').trim() || null,
    school_department: String(lower.school_department || lower.department || lower.school || lower.location || '').trim() || null,
    job_title: String(lower.job_title || lower.title || lower.position || '').trim() || null,
    eligible_to_vote: bool(lower.eligible_to_vote, true),
    eligible_for_award: bool(lower.eligible_for_award, true),
    active: bool(lower.active, true)
  };
}

async function importEmployees() {
  if (!state.importRows.length) return;
  const button = $('importEmployeesButton');
  setLoading(button, true, 'Importing...');
  try {
    const chunkSize = 250;
    for (let i = 0; i < state.importRows.length; i += chunkSize) {
      const { error } = await supabaseClient.from('employees').upsert(state.importRows.slice(i,i+chunkSize), { onConflict: 'employee_number' });
      if (error) throw error;
    }
    showToast(`${state.importRows.length} employee records imported.`);
    $('employeeFileInput').value = '';
    $('importPreview').textContent = 'No file selected.';
    state.importRows = [];
    await loadAdminDashboard();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setLoading(button, false);
    button.disabled = !state.importRows.length;
  }
}

async function saveEmployee(event) {
  event.preventDefault();
  const id = Number($('employeeRecordId').value) || null;
  const payload = {
    employee_number: $('employeeNumber').value.trim(),
    email: $('employeeEmail').value.trim() || null,
    first_name: $('employeeFirstName').value.trim(),
    last_name: $('employeeLastName').value.trim(),
    school_department: $('employeeDepartment').value.trim() || null,
    job_title: $('employeeJobTitle').value.trim() || null,
    eligible_to_vote: $('employeeCanVote').checked,
    eligible_for_award: $('employeeCanWin').checked,
    active: $('employeeActive').checked
  };
  const query = id ? supabaseClient.from('employees').update(payload).eq('id', id) : supabaseClient.from('employees').insert(payload);
  const { error } = await query;
  if (error) return showToast(error.message, true);
  showToast(id ? 'Employee updated.' : 'Employee added.');
  clearEmployeeForm();
  await loadAdminDashboard();
}

function renderEmployeeTable() {
  const query = $('employeeSearch').value.trim().toLowerCase();
  const filtered = state.employees.filter(employee => Object.values(employee).filter(v => typeof v === 'string').join(' ').toLowerCase().includes(query));
  $('employeeCountLabel').textContent = `${filtered.length} employees`;
  $('employeeTableBody').innerHTML = filtered.length ? filtered.map(employee => `
    <tr><td><strong>${escapeHtml(candidateName(employee))}</strong><br><small>${escapeHtml(employee.employee_number)}</small></td><td>${escapeHtml(employee.email || '—')}</td><td>${escapeHtml(employee.school_department || '—')}</td><td>${escapeHtml(employee.job_title || '—')}</td><td>${employee.eligible_to_vote ? 'Yes' : 'No'}</td><td>${employee.eligible_for_award ? 'Yes' : 'No'}</td><td><span class="status-pill ${employee.active ? 'status-green' : 'status-gray'}">${employee.active ? 'Active' : 'Inactive'}</span></td><td><button class="btn btn-light edit-employee" data-id="${employee.id}" type="button">Edit</button></td></tr>`).join('') : '<tr><td colspan="8" class="muted">No employees found.</td></tr>';
  $$('.edit-employee').forEach(button => button.addEventListener('click', () => editEmployee(Number(button.dataset.id))));
}

function editEmployee(id) {
  const employee = state.employees.find(item => item.id === id);
  if (!employee) return;
  $('employeeRecordId').value = employee.id;
  $('employeeNumber').value = employee.employee_number || '';
  $('employeeEmail').value = employee.email || '';
  $('employeeFirstName').value = employee.first_name || '';
  $('employeeLastName').value = employee.last_name || '';
  $('employeeDepartment').value = employee.school_department || '';
  $('employeeJobTitle').value = employee.job_title || '';
  $('employeeCanVote').checked = employee.eligible_to_vote;
  $('employeeCanWin').checked = employee.eligible_for_award;
  $('employeeActive').checked = employee.active;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearEmployeeForm() {
  $('employeeForm').reset();
  $('employeeRecordId').value = '';
  $('employeeCanVote').checked = true;
  $('employeeCanWin').checked = true;
  $('employeeActive').checked = true;
}

function openVoteCorrection(voteId) {
  const vote = state.votes.find(item => item.id === voteId);
  if (!vote) return;
  $('editVoteId').value = vote.id;
  $('editVoteCandidate').innerHTML = state.candidates.map(candidate => `<option value="${candidate.id}" ${candidate.id === vote.candidate_employee_id ? 'selected' : ''}>${escapeHtml(candidateName(candidate))}</option>`).join('');
  $('editVoteReason').value = '';
  $('editVoteModal').classList.remove('hidden');
}

async function saveVoteCorrection() {
  const id = Number($('editVoteId').value);
  const reason = $('editVoteReason').value.trim();
  if (!reason) return showToast('Enter a reason for the correction.', true);
  const { error } = await supabaseClient.from('votes').update({
    candidate_employee_id: Number($('editVoteCandidate').value),
    admin_note: reason
  }).eq('id', id);
  if (error) return showToast(error.message, true);
  closeModal('editVoteModal');
  showToast('Vote corrected and audit log updated.');
  await loadElectionAdminData();
}

async function deleteVote(voteId) {
  const reason = prompt('Enter the reason this vote is being deleted:');
  if (!reason?.trim()) return;
  const { error: noteError } = await supabaseClient.from('votes').update({ admin_note: reason.trim() }).eq('id', voteId);
  if (noteError) return showToast(noteError.message, true);
  const { error } = await supabaseClient.from('votes').delete().eq('id', voteId);
  if (error) return showToast(error.message, true);
  showToast('Vote deleted and recorded in the audit log.');
  await loadElectionAdminData();
}

function downloadCsv(filename, rows) {
  if (!rows.length) return showToast('There is no data to export.', true);
  const headers = Object.keys(rows[0]);
  const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
  const csv = [headers.map(quote).join(','), ...rows.map(row => headers.map(header => quote(row[header])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportParticipation() {
  downloadCsv('employee-of-month-participation.csv', state.participation.map(row => ({
    Employee: `${row.first_name} ${row.last_name}`,
    Department: row.school_department,
    Status: row.has_voted ? 'Voted' : 'Not Voted',
    Submitted: row.submitted_at ? formatDate(row.submitted_at) : ''
  })));
}

function exportResults() {
  downloadCsv('employee-of-month-results.csv', state.results.map(row => ({
    Rank: row.result_rank,
    Candidate: `${row.first_name} ${row.last_name}`,
    Department: row.school_department,
    Votes: row.vote_count
  })));
}

document.addEventListener('DOMContentLoaded', initialize);
