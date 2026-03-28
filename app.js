(function () {
  'use strict';

  var PROJECT_NUMBER = 1;
  var PROJECT_OWNER = 'ksk3304';
  var GRAPHQL_URL = 'https://api.github.com/graphql';
  var PAGE_SIZE = 100;

  var dateDisplay = document.getElementById('date-display');
  var authSection = document.getElementById('auth-section');
  var patInput = document.getElementById('pat-input');
  var patSubmit = document.getElementById('pat-submit');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var errorMessage = document.getElementById('error-message');
  var retryBtn = document.getElementById('retry-btn');
  var resetTokenBtn = document.getElementById('reset-token-btn');
  var issueList = document.getElementById('issue-list');
  var refreshBtn = document.getElementById('refresh-btn');
  var logoutBtn = document.getElementById('logout-btn');

  function getToday() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function formatDateHeader(dateStr) {
    var parts = dateStr.split('-');
    var m = parseInt(parts[1]);
    var d = parseInt(parts[2]);
    var today = getToday();
    if (dateStr === today) return m + '/' + d + '（今日）';
    return m + '/' + d;
  }

  function init() {
    dateDisplay.textContent = getToday();

    var token = localStorage.getItem('gh_pat');
    if (token) {
      fetchIssues(token);
    } else {
      showAuth();
    }

    patSubmit.addEventListener('click', handleAuth);
    patInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleAuth();
    });
    retryBtn.addEventListener('click', function () {
      var token = localStorage.getItem('gh_pat');
      if (token) fetchIssues(token);
    });
    resetTokenBtn.addEventListener('click', function () {
      localStorage.removeItem('gh_pat');
      showAuth();
    });
    refreshBtn.addEventListener('click', function () {
      var token = localStorage.getItem('gh_pat');
      if (token) fetchIssues(token);
    });
    logoutBtn.addEventListener('click', function () {
      localStorage.removeItem('gh_pat');
      issueList.innerHTML = '';
      refreshBtn.style.display = 'none';
      logoutBtn.style.display = 'none';
      showAuth();
    });
  }

  function showAuth() {
    authSection.style.display = 'block';
    loadingEl.style.display = 'none';
    errorEl.style.display = 'none';
    issueList.innerHTML = '';
    refreshBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
  }

  function showLoading() {
    authSection.style.display = 'none';
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    issueList.innerHTML = '';
  }

  function showError(msg) {
    authSection.style.display = 'none';
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessage.textContent = msg;
  }

  function handleAuth() {
    var token = patInput.value.trim();
    if (!token) return;
    localStorage.setItem('gh_pat', token);
    patInput.value = '';
    fetchIssues(token);
  }

  function buildQuery(cursor) {
    var after = cursor ? ', after: "' + cursor + '"' : '';
    return '{ user(login: "' + PROJECT_OWNER + '") { projectV2(number: ' + PROJECT_NUMBER + ') { items(first: ' + PAGE_SIZE + after + ') { nodes { fieldValues(first: 10) { nodes { ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } } ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } } } content { ... on Issue { number title url state labels(first: 5) { nodes { name } } } } } pageInfo { hasNextPage endCursor } } } } }';
  }

  function graphqlRequest(token, query) {
    return fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: query }),
    }).then(function (res) {
      if (!res.ok) {
        if (res.status === 401) throw new Error('認証エラー: トークンが無効です');
        if (res.status === 403) throw new Error('権限エラー: repo + project スコープが必要です');
        throw new Error('API エラー: ' + res.status);
      }
      return res.json();
    }).then(function (json) {
      if (json.errors) {
        throw new Error('GraphQL エラー: ' + json.errors[0].message);
      }
      return json;
    });
  }

  function fetchAllItems(token) {
    var allItems = [];
    function fetchPage(cursor) {
      var query = buildQuery(cursor);
      return graphqlRequest(token, query).then(function (json) {
        var items = json.data.user.projectV2.items;
        allItems = allItems.concat(items.nodes);
        if (items.pageInfo.hasNextPage) {
          return fetchPage(items.pageInfo.endCursor);
        }
        return allItems;
      });
    }
    return fetchPage(null);
  }

  function parseItem(node) {
    var content = node.content;
    if (!content || !content.number) return null;

    var dueDate = null;
    var status = null;

    var fieldNodes = node.fieldValues.nodes;
    for (var i = 0; i < fieldNodes.length; i++) {
      var fn = fieldNodes[i];
      if (fn.date && fn.field && fn.field.name === 'Due Date') {
        dueDate = fn.date;
      }
      if (fn.name && fn.field && fn.field.name === 'Status') {
        status = fn.name;
      }
    }

    if (!dueDate) return null;

    var labels = [];
    if (content.labels && content.labels.nodes) {
      for (var j = 0; j < content.labels.nodes.length; j++) {
        labels.push(content.labels.nodes[j].name);
      }
    }

    return {
      number: content.number,
      title: content.title,
      url: content.url,
      state: content.state,
      dueDate: dueDate,
      status: status || 'Unknown',
      labels: labels,
    };
  }

  function fetchIssues(token) {
    showLoading();

    fetchAllItems(token).then(function (allItems) {
      var today = getToday();
      var issues = [];

      for (var i = 0; i < allItems.length; i++) {
        var parsed = parseItem(allItems[i]);
        if (parsed && parsed.dueDate <= today && parsed.state === 'OPEN') {
          issues.push(parsed);
        }
      }

      issues.sort(function (a, b) {
        if (a.dueDate < b.dueDate) return -1;
        if (a.dueDate > b.dueDate) return 1;
        return 0;
      });

      renderIssues(issues, today);
    }).catch(function (err) {
      showError(err.message);
    });
  }

  function renderIssues(issues, today) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'none';
    authSection.style.display = 'none';
    issueList.innerHTML = '';
    refreshBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'inline-block';

    if (issues.length === 0) {
      issueList.innerHTML = '<p class="empty-message">タスクなし</p>';
      return;
    }

    // Group by date
    var groups = {};
    var dates = [];
    for (var i = 0; i < issues.length; i++) {
      var date = issues[i].dueDate;
      if (!groups[date]) {
        groups[date] = [];
        dates.push(date);
      }
      groups[date].push(issues[i]);
    }
    dates.sort();

    for (var d = 0; d < dates.length; d++) {
      var date = dates[d];
      var items = groups[date];
      var isOverdue = date < today;
      var isToday = date === today;

      var header = document.createElement('div');
      header.className = 'section-header';
      var label = formatDateHeader(date);
      if (isOverdue) label += ' - 期限切れ';
      header.textContent = label + ' (' + items.length + ')';
      issueList.appendChild(header);

      for (var j = 0; j < items.length; j++) {
        var type = isOverdue ? 'overdue' : (isToday ? 'today' : '');
        issueList.appendChild(createCard(items[j], type));
      }
    }
  }

  function createCard(issue, type) {
    var a = document.createElement('a');
    a.className = 'issue-card ' + type;
    a.href = issue.url;
    a.target = '_blank';
    a.rel = 'noopener';

    var title = document.createElement('div');
    title.className = 'issue-title';
    title.textContent = '#' + issue.number + ' ' + issue.title;

    var meta = document.createElement('div');
    meta.className = 'issue-meta';

    var statusSpan = document.createElement('span');
    var statusClass = 'status-todo';
    if (issue.status === 'In Progress') statusClass = 'status-in-progress';
    if (issue.status === 'Done') statusClass = 'status-done';
    if (issue.status === 'Pending') statusClass = 'status-pending';
    statusSpan.className = 'issue-status ' + statusClass;
    statusSpan.textContent = issue.status;

    meta.appendChild(statusSpan);
    a.appendChild(title);
    a.appendChild(meta);

    if (issue.labels.length > 0) {
      var labelsDiv = document.createElement('div');
      labelsDiv.className = 'issue-labels';
      for (var i = 0; i < issue.labels.length; i++) {
        var tag = document.createElement('span');
        tag.className = 'label-tag';
        tag.textContent = issue.labels[i];
        labelsDiv.appendChild(tag);
      }
      a.appendChild(labelsDiv);
    }

    return a;
  }

  init();
})();
