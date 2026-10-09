// Smart AI Gateway Client App
document.addEventListener('DOMContentLoaded', () => {
  // 1. Tab Navigation
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPane = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const pane = document.getElementById(`pane${targetPane.charAt(0).toUpperCase() + targetPane.slice(1)}`) ||
                   document.getElementById(`pane${targetPane}`) ||
                   document.getElementById('paneVirtualKeys');
      if (pane) pane.classList.add('active');
    });
  });

  const btnShortcut = document.getElementById('btnManageKeysShortcut');
  if (btnShortcut) {
    btnShortcut.addEventListener('click', () => {
      document.getElementById('tabKeys').click();
    });
  }

  // 2. API Key Management & Local Storage
  const providers = ['openai', 'anthropic', 'gemini', 'deepseek'];

  function loadStoredKeys() {
    providers.forEach(p => {
      const stored = localStorage.getItem(`gateway_key_${p}`);
      const input = document.getElementById(`key${capitalize(p)}`);
      const badge = document.getElementById(`badge${capitalize(p)}`);

      if (stored && input) {
        input.value = stored;
      }
      updateBadge(p, Boolean(stored));
    });
    updateActiveKeyLabel();
  }

  function saveKeys() {
    providers.forEach(p => {
      const input = document.getElementById(`key${capitalize(p)}`);
      if (input && input.value.trim()) {
        localStorage.setItem(`gateway_key_${p}`, input.value.trim());
        updateBadge(p, true);
      } else {
        localStorage.removeItem(`gateway_key_${p}`);
        updateBadge(p, false);
      }
    });
    updateActiveKeyLabel();
    alert('API keys saved securely in browser storage!');
  }

  function updateBadge(provider, isSet) {
    const badge = document.getElementById(`badge${capitalize(provider)}`);
    if (!badge) return;
    if (isSet) {
      badge.textContent = 'Active (Local)';
      badge.className = 'badge badge-set';
    } else {
      badge.textContent = 'Not Set';
      badge.className = 'badge';
    }
  }

  function updateActiveKeyLabel() {
    const activeLabel = document.getElementById('activeKeyLabel');
    if (!activeLabel) return;

    const currentModel = document.getElementById('modelSelect')?.value || '';
    const resolved = resolveProviderForModel(currentModel);
    const key = localStorage.getItem(`gateway_key_${resolved}`);

    if (key) {
      activeLabel.textContent = `Using: Client Key for ${resolved.toUpperCase()}`;
    } else {
      activeLabel.textContent = `Using: Gateway Default Pool for ${resolved.toUpperCase()}`;
    }
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  const btnSave = document.getElementById('btnSaveAllKeys');
  if (btnSave) btnSave.addEventListener('click', saveKeys);

  // Toggle password visibility
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle');
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  });

  // Slider label updates
  const tempSlider = document.getElementById('temperatureSlider');
  const tempVal = document.getElementById('tempValue');
  if (tempSlider && tempVal) {
    tempSlider.addEventListener('input', (e) => {
      tempVal.textContent = e.target.value;
    });
  }

  // RouteLLM Slider sync
  const routellmSlider = document.getElementById('routellmSlider');
  const routellmVal = document.getElementById('routellmThresholdVal');
  if (routellmSlider && routellmVal) {
    routellmSlider.addEventListener('input', (e) => {
      routellmVal.textContent = e.target.value;
    });
  }

  // Model change sync
  const modelSelect = document.getElementById('modelSelect');
  const activeModelBadge = document.getElementById('activeModelBadge');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      if (activeModelBadge) activeModelBadge.textContent = modelSelect.value;
      updateActiveKeyLabel();
    });
  }

  function resolveProviderForModel(model) {
    const lower = model.toLowerCase();
    if (lower.startsWith('claude') || lower.includes('anthropic')) return 'anthropic';
    if (lower.startsWith('gemini') || lower.includes('google')) return 'gemini';
    if (lower.startsWith('deepseek')) return 'deepseek';
    return 'openai';
  }

  // 3. Interactive Chat & Streaming
  const chatMessages = document.getElementById('chatMessages');
  const promptInput = document.getElementById('promptInput');
  const btnSend = document.getElementById('btnSend');
  const btnClear = document.getElementById('btnClearChat');
  const statsBar = document.getElementById('chatStatsBar');
  const statLatency = document.getElementById('statLatency');
  const statTokens = document.getElementById('statTokens');
  const statSpeed = document.getElementById('statSpeed');

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      chatMessages.innerHTML = `
        <div class="chat-message assistant">
          <div class="message-avatar">AI</div>
          <div class="message-content">
            <p>Chat cleared. Ask anything to test the universal gateway!</p>
          </div>
        </div>
      `;
      statsBar.style.display = 'none';
    });
  }

  if (btnSend && promptInput) {
    btnSend.addEventListener('click', sendPrompt);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    });
  }

  async function sendPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    // Append user message
    appendMessage('user', prompt);
    promptInput.value = '';

    const model = modelSelect.value;
    const providerOverride = document.getElementById('providerSelect').value;
    const systemPrompt = document.getElementById('systemPrompt').value.trim();
    const temperature = parseFloat(tempSlider.value);
    const reasoningEffort = document.getElementById('reasoningSelect').value;
    const isStream = document.getElementById('streamToggle').checked;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const requestPayload = {
      model,
      messages,
      temperature,
      stream: isStream,
      ...(reasoningEffort !== 'none' ? { reasoning_effort: reasoningEffort } : {}),
    };

    const targetProvider = providerOverride !== 'auto' ? providerOverride : resolveProviderForModel(model);
    const clientApiKey = localStorage.getItem(`gateway_key_${targetProvider}`);

    const headers = {
      'Content-Type': 'application/json',
    };
    if (providerOverride !== 'auto') {
      headers['x-provider'] = providerOverride;
    }
    const virtualKeySelect = document.getElementById('virtualKeySelect');
    if (virtualKeySelect && virtualKeySelect.value && virtualKeySelect.value !== 'none') {
      headers['Authorization'] = `Bearer ${virtualKeySelect.value}`;
    } else if (clientApiKey) {
      headers['Authorization'] = `Bearer ${clientApiKey}`;
    }
    if (routellmSlider) {
      headers['x-threshold'] = routellmSlider.value;
    }

    const hedgingToggle = document.getElementById('hedgingToggle');
    if (hedgingToggle && hedgingToggle.checked) {
      headers['x-hedging'] = 'true';
      headers['x-hedge-delay'] = '2000';
    }

    // Append assistant placeholder
    const assistantBubble = appendMessage('assistant', isStream ? '...' : 'Generating response...');
    const startTime = performance.now();
    let tokenCount = 0;
    statsBar.style.display = 'flex';
    statLatency.textContent = 'connecting...';
    statTokens.textContent = '0';
    statSpeed.textContent = '0 t/s';

    btnSend.disabled = true;

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
      });

      const firstByteTime = performance.now();
      const gatewayProv = response.headers.get('x-gateway-provider') || '';
      const gatewayMod = response.headers.get('x-gateway-model') || '';
      const gatewayStrat = response.headers.get('x-gateway-strategy') || '';
      const routellmScore = response.headers.get('x-gateway-routellm-score');

      const circuitState = response.headers.get('x-gateway-circuit-state');
      const circuitBadge = document.getElementById('circuitBadge');
      if (circuitBadge && circuitState) {
        circuitBadge.style.display = 'inline-flex';
        circuitBadge.textContent = `Circuit: ${circuitState}`;
        circuitBadge.className = circuitState === 'CLOSED'
          ? 'badge badge-set'
          : circuitState === 'HALF_OPEN'
            ? 'badge pill-amber'
            : 'badge pill-rose';
      }

      const isHedged = response.headers.get('x-gateway-hedged');
      const hedgeWinner = response.headers.get('x-gateway-hedge-winner');
      const hedgeBadge = document.getElementById('hedgeBadge');
      if (hedgeBadge) {
        if (isHedged === 'true') {
          hedgeBadge.style.display = 'inline-flex';
          hedgeBadge.textContent = `Hedge: ${hedgeWinner || 'backup'} won`;
        } else {
          hedgeBadge.style.display = 'none';
        }
      }

      const routeInfo = gatewayProv && gatewayMod
        ? ` [${gatewayStrat === 'routellm-pareto' ? 'RouteLLM' : 'Cascade'} ➔ ${gatewayMod}]`
        : '';

      statLatency.textContent = `${Math.round(firstByteTime - startTime)}ms${routeInfo}`;

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson.error?.message || response.statusText || 'Request failed';
        assistantBubble.innerHTML = `<span style="color: var(--accent-rose); font-weight: 600;">[Error ${response.status}]</span> ${errMsg}`;
        return;
      }

      const costUsd = response.headers.get('x-gateway-cost-usd');
      const statCost = document.getElementById('statCost');
      if (statCost && costUsd) {
        statCost.textContent = `$${parseFloat(costUsd).toFixed(6)}`;
      }

      if (!isStream) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '(Empty content)';
        assistantBubble.textContent = text;
        const totalTime = (performance.now() - startTime) / 1000;
        const totalTok = data.usage?.total_tokens || Math.round(text.length / 4);
        statTokens.textContent = `${totalTok}`;
        statSpeed.textContent = `${(totalTok / totalTime).toFixed(1)} t/s`;

        const rlLimit = response.headers.get('x-ratelimit-limit-requests');
        const rlRemaining = response.headers.get('x-ratelimit-remaining-requests');
        const rlChip = rlLimit ? `<span class="meta-chip meta-ratelimit">⏱️ ${rlRemaining}/${rlLimit} req</span>` : '';

        const footer = document.createElement('div');
        footer.className = 'message-meta-footer';
        footer.innerHTML = `
          <span class="meta-chip meta-cost">$${parseFloat(costUsd || data.usage?.estimated_cost_usd || '0').toFixed(6)}</span>
          <span class="meta-chip">${totalTok} tokens</span>
          <span class="meta-chip">${gatewayMod || 'model'}</span>
          ${rlChip}
        `;
        assistantBubble.appendChild(footer);
      } else {
        // SSE streaming
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        assistantBubble.textContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep remainder

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullText += delta;
                  assistantBubble.textContent = fullText;
                  tokenCount++;
                  chatMessages.scrollTop = chatMessages.scrollHeight;

                  const elapsed = (performance.now() - firstByteTime) / 1000;
                  statTokens.textContent = `${tokenCount}`;
                  if (elapsed > 0.1) {
                    statSpeed.textContent = `${(tokenCount / elapsed).toFixed(1)} t/s`;
                  }
                }
              } catch {
                // Ignore chunk parse errors
              }
            }
          }
        }

        if (!fullText) {
          assistantBubble.textContent = '(Stream completed with empty content)';
        }

        const rlLimit = response.headers.get('x-ratelimit-limit-requests');
        const rlRemaining = response.headers.get('x-ratelimit-remaining-requests');
        const rlChip = rlLimit ? `<span class="meta-chip meta-ratelimit">⏱️ ${rlRemaining}/${rlLimit} req</span>` : '';

        const estTok = tokenCount || Math.round(fullText.length / 3.8);
        const footer = document.createElement('div');
        footer.className = 'message-meta-footer';
        footer.innerHTML = `
          <span class="meta-chip meta-cost">$${parseFloat(costUsd || '0.000015').toFixed(6)}</span>
          <span class="meta-chip">${estTok} tokens</span>
          <span class="meta-chip">${gatewayMod || 'model'}</span>
          ${rlChip}
        `;
        assistantBubble.appendChild(footer);
      }
    } catch (err) {
      assistantBubble.innerHTML = `<span style="color: var(--accent-rose); font-weight: 600;">[Network Error]</span> ${err.message}`;
    } finally {
      btnSend.disabled = false;
    }
  }

  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'ME' : 'AI';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(content);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return content;
  }

  // 4. Test Key Buttons
  document.querySelectorAll('[data-test]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provider = btn.getAttribute('data-test');
      const input = document.getElementById(`key${capitalize(provider)}`);
      const keyVal = input ? input.value.trim() : '';

      if (!keyVal) {
        alert(`Please enter a key for ${provider.toUpperCase()} first!`);
        return;
      }

      btn.textContent = 'Testing...';
      btn.disabled = true;

      const modelMap = {
        openai: 'gpt-4o-mini',
        anthropic: 'claude-3-5-haiku-20241022',
        gemini: 'gemini-1.5-flash',
        deepseek: 'deepseek-chat',
      };

      try {
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-provider': provider,
            'Authorization': `Bearer ${keyVal}`,
          },
          body: JSON.stringify({
            model: modelMap[provider] || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 5,
          }),
        });

        if (res.ok) {
          btn.textContent = 'Valid!';
          btn.style.color = 'var(--accent-emerald)';
        } else {
          btn.textContent = 'Refused';
          btn.style.color = 'var(--accent-rose)';
        }
      } catch {
        btn.textContent = 'Failed';
        btn.style.color = 'var(--accent-rose)';
      } finally {
        setTimeout(() => {
          btn.textContent = 'Test Key';
          btn.disabled = false;
          btn.style.color = '';
        }, 3000);
      }
    });
  });

  // 5. Backend Key Pool Polling & Rendering
  const poolTableBody = document.getElementById('poolTableBody');

  async function fetchAndRenderPool() {
    try {
      const res = await fetch('/api/pool');
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.pool) || !poolTableBody) return;

      poolTableBody.innerHTML = data.pool.map(k => {
        const statusBadge = k.isCoolingDown
          ? `<span class="pill" style="background: rgba(244, 63, 94, 0.2); color: #f43f5e;">Cooldown (${k.cooldownRemainingSeconds}s)</span>`
          : k.isHealthy
            ? `<span class="pill pill-active">Active</span>`
            : `<span class="pill pill-queued">Offline</span>`;

        return `
          <tr>
            <td><code>${k.provider}</code></td>
            <td><strong>${k.id}</strong></td>
            <td><code>${k.maskedKey}</code></td>
            <td>${k.weight}</td>
            <td>${statusBadge}</td>
            <td>${k.isCoolingDown ? k.cooldownRemainingSeconds + 's (' + (k.cooldownReason || '429') + ')' : '0s'}</td>
          </tr>
        `;
      }).join('');
    } catch {
      // Ignore polling errors
    }
  }

  // 6. Resilience & Circuit Breaker Polling & Controls
  const circuitCardsGrid = document.getElementById('circuitCardsGrid');

  async function fetchAndRenderResilience() {
    try {
      const res = await fetch('/api/resilience');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.breakers || !circuitCardsGrid) return;

      const providerDescriptions = {
        openai: 'Primary Model Cluster (GPT-4o, o3-mini)',
        anthropic: 'Claude 3.5 Sonnet / Haiku Cluster',
        gemini: 'Google Gemini 1.5/2.0 Flash & Pro',
        deepseek: 'DeepSeek Chat & Reasoner Cluster',
      };

      const html = Object.entries(data.breakers).map(([provider, b]) => {
        const stateClass = b.state === 'OPEN'
          ? 'state-open'
          : b.state === 'HALF_OPEN'
            ? 'state-half-open'
            : '';

        const pillClass = b.state === 'CLOSED'
          ? 'pill-done'
          : b.state === 'HALF_OPEN'
            ? 'pill-amber'
            : 'pill-rose';

        const cooldownText = b.state === 'OPEN'
          ? `${Math.ceil(b.cooldownRemainingMs / 1000)}s backoff remaining`
          : b.state === 'HALF_OPEN'
            ? 'Canary Probing Active'
            : 'Operational (Ready)';

        return `
          <div class="circuit-card ${stateClass}">
            <div class="circuit-header">
              <div>
                <strong>${provider}</strong>
                <span class="circuit-sub">${providerDescriptions[provider] || 'Provider Cluster'}</span>
              </div>
              <span class="pill ${pillClass}">${b.state}</span>
            </div>
            <div class="circuit-metrics">
              <div class="metric-row"><span>Failures:</span><strong>${b.consecutiveFailures} / 3</strong></div>
              <div class="metric-row"><span>Canary Probes:</span><strong>${b.consecutiveSuccesses} / 2</strong></div>
              <div class="metric-row"><span>Total Trips:</span><strong>${b.totalTrips}</strong></div>
              <div class="metric-row"><span>Cooldown:</span><strong>${cooldownText}</strong></div>
            </div>
            <div class="circuit-actions">
              <button class="btn btn-sm btn-secondary" onclick="window.tripBreaker('${provider}')">Simulate Outage</button>
              <button class="btn btn-sm" onclick="window.resetBreaker('${provider}')">Reset</button>
            </div>
          </div>
        `;
      }).join('');

      circuitCardsGrid.innerHTML = html;
    } catch {
      // Ignore polling errors
    }
  }

  window.tripBreaker = async (provider) => {
    try {
      await fetch('/api/resilience/trip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      fetchAndRenderResilience();
    } catch (e) {
      alert(`Failed to trip breaker: ${e.message}`);
    }
  };

  window.resetBreaker = async (provider) => {
    try {
      await fetch('/api/resilience/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      fetchAndRenderResilience();
    } catch (e) {
      alert(`Failed to reset breaker: ${e.message}`);
    }
  };

  const btnResetAll = document.getElementById('btnResetAllCircuits');
  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      try {
        await fetch('/api/resilience/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        fetchAndRenderResilience();
      } catch (e) {
        alert(`Failed to reset all circuits: ${e.message}`);
      }
    });
  }

  // 7. Telemetry & Cost Analytics Polling & Rendering
  async function fetchAndRenderTelemetry() {
    try {
      // 1. KPIs
      const statsRes = await fetch('/api/telemetry/stats');
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const kpis = statsData.kpis;
        if (kpis) {
          const reqEl = document.getElementById('kpiTotalRequests');
          const tokEl = document.getElementById('kpiTotalTokens');
          const costEl = document.getElementById('kpiTotalCost');
          const latEl = document.getElementById('kpiAvgLatency');
          const spdEl = document.getElementById('kpiAvgSpeed');
          const splitEl = document.getElementById('kpiTokenSplit');
          const ratioEl = document.getElementById('kpiSuccessRatio');

          if (reqEl) reqEl.textContent = kpis.totalRequests.toLocaleString();
          if (tokEl) tokEl.textContent = kpis.totalTokens.toLocaleString();
          if (costEl) costEl.textContent = `$${kpis.totalCostUsd.toFixed(6)}`;
          if (latEl) latEl.textContent = `${kpis.avgLatencyMs} ms`;
          if (spdEl) spdEl.textContent = `${kpis.avgTokensPerSecond} t/s`;
          if (splitEl) splitEl.textContent = `${kpis.totalPromptTokens.toLocaleString()} in / ${kpis.totalCompletionTokens.toLocaleString()} out`;
          if (ratioEl) {
            const pct = kpis.totalRequests > 0
              ? Math.round((kpis.successfulRequests / kpis.totalRequests) * 100)
              : 100;
            ratioEl.textContent = `${pct}% success rate (${kpis.successfulRequests} ok / ${kpis.failedRequests} fail)`;
          }
        }
      }

      // 2. Recent Requests Table
      const reqsRes = await fetch('/api/telemetry/requests?limit=25');
      if (reqsRes.ok) {
        const reqsData = await reqsRes.json();
        const tableBody = document.getElementById('requestsTableBody');
        const countBadge = document.getElementById('auditCountBadge');
        if (tableBody && Array.isArray(reqsData.requests)) {
          if (countBadge) countBadge.textContent = `${reqsData.requests.length} requests`;

          if (reqsData.requests.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-dim);">No requests logged yet. Send a prompt from the AI Playground to see live telemetry!</td></tr>`;
          } else {
            tableBody.innerHTML = reqsData.requests.map(r => {
              const timeStr = new Date(r.timestamp).toLocaleTimeString();
              const statusPill = r.statusCode === 200
                ? `<span class="pill pill-done">200 OK</span>`
                : `<span class="pill pill-rose">${r.statusCode}</span>`;

              return `
                <tr>
                  <td style="font-family: var(--font-mono); font-size: 0.75rem;">${timeStr}</td>
                  <td><strong>${r.model}</strong></td>
                  <td><code>${r.provider}</code></td>
                  <td><span class="badge" style="font-size: 0.7rem;">${r.strategy}</span></td>
                  <td>${r.promptTokens}</td>
                  <td>${r.completionTokens}</td>
                  <td><strong>${r.totalTokens}</strong></td>
                  <td>${r.latencyMs}ms</td>
                  <td>${r.tokensPerSecond} t/s</td>
                  <td style="color: var(--accent-emerald); font-weight: 600;">$${r.costUsd.toFixed(6)}</td>
                  <td>${statusPill}</td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch {
      // Ignore polling errors
    }
  }

  async function fetchAndRenderPricing() {
    try {
      const res = await fetch('/api/pricing');
      if (!res.ok) return;
      const data = await res.json();
      const tableBody = document.getElementById('pricingTableBody');
      if (!tableBody || !data.pricing) return;

      tableBody.innerHTML = Object.entries(data.pricing).map(([model, rate]) => {
        return `
          <tr>
            <td><strong>${model}</strong></td>
            <td><code>${rate.provider}</code></td>
            <td style="color: var(--accent-cyan); font-weight: 600;">$${rate.inputPerMillion.toFixed(2)}</td>
            <td style="color: var(--accent-violet); font-weight: 600;">$${rate.outputPerMillion.toFixed(2)}</td>
            <td>${rate.cacheReadPerMillion != null ? `$${rate.cacheReadPerMillion.toFixed(3)}` : '<span style="color: var(--text-dim);">-</span>'}</td>
          </tr>
        `;
      }).join('');
    } catch {
      // Ignore pricing errors
    }
  }

  // 7. Feature 6: Virtual Keys & Team Quotas UI
  let cachedVirtualKeys = [];

  async function fetchAndRenderVirtualKeys() {
    try {
      const res = await fetch('/api/virtual-keys');
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.keys)) return;

      cachedVirtualKeys = data.keys;

      // Update KPI cards
      const totalCount = data.keys.length;
      const activeCount = data.keys.filter(k => k.status === 'active').length;
      const totalSpend = data.keys.reduce((sum, k) => sum + (k.currentSpendUsd || 0), 0);
      const totalRpm = data.keys.reduce((sum, k) => sum + (k.currentRpm || 0), 0);
      const totalTpm = data.keys.reduce((sum, k) => sum + (k.currentTpm || 0), 0);

      const elTotal = document.getElementById('vkTotalCount');
      const elActive = document.getElementById('vkActiveCount');
      const elSpend = document.getElementById('vkTotalSpend');
      const elRpm = document.getElementById('vkActiveRpm');
      const elTpm = document.getElementById('vkActiveTpm');

      if (elTotal) elTotal.textContent = totalCount.toString();
      if (elActive) elActive.textContent = activeCount.toString();
      if (elSpend) elSpend.textContent = `$${totalSpend.toFixed(4)}`;
      if (elRpm) elRpm.textContent = `${totalRpm} RPM`;
      if (elTpm) elTpm.textContent = `${(totalTpm / 1000).toFixed(1)}k TPM`;

      // Update Playground Virtual Key Select dropdown
      const vkSelect = document.getElementById('virtualKeySelect');
      if (vkSelect) {
        const currentSelected = vkSelect.value;
        const optionsHtml = ['<option value="none">Direct / Backend Pool Keys</option>'];
        data.keys.forEach(k => {
          const budgetTxt = k.maxBudgetUsd ? ` · $${k.maxBudgetUsd}` : '';
          optionsHtml.push(`<option value="${k.maskedKey}">${k.name} (${k.rpmLimit} RPM${budgetTxt})</option>`);
        });
        vkSelect.innerHTML = optionsHtml.join('');
        if (currentSelected && optionsHtml.some(o => o.includes(currentSelected))) {
          vkSelect.value = currentSelected;
        }
      }

      // Render Virtual Keys Table
      const tableBody = document.getElementById('virtualKeysTableBody');
      if (tableBody) {
        if (data.keys.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim);">No virtual keys created yet. Click "Generate Virtual Key" to start.</td></tr>`;
        } else {
          tableBody.innerHTML = data.keys.map(k => {
            const statusPill = k.status === 'active'
              ? `<span class="pill pill-done">Active</span>`
              : k.status === 'exhausted'
                ? `<span class="pill pill-rose">Exhausted</span>`
                : `<span class="pill pill-amber">Revoked</span>`;

            let budgetHtml;
            if (k.maxBudgetUsd && k.maxBudgetUsd > 0) {
              const pct = k.budgetPercentage || 0;
              const fillClass = pct >= 95 ? 'danger' : pct >= 75 ? 'warning' : '';
              budgetHtml = `
                <div class="budget-progress">
                  <div class="budget-text"><span>$${k.currentSpendUsd.toFixed(4)}</span><span>$${k.maxBudgetUsd.toFixed(2)} (${pct}%)</span></div>
                  <div class="budget-progress-bar"><div class="budget-progress-fill ${fillClass}" style="width: ${Math.min(100, pct)}%;"></div></div>
                </div>
              `;
            } else {
              budgetHtml = `<span style="font-family: var(--font-mono); font-size: 0.75rem;">$${k.currentSpendUsd.toFixed(4)} <span style="color: var(--text-dim);">(Unlimited)</span></span>`;
            }

            const modelTags = k.allowedModels.map(m => `<span class="badge" style="font-size: 0.65rem; margin: 1px;">${m}</span>`).join(' ');

            return `
              <tr>
                <td><strong>${k.name}</strong><br><span style="font-size: 0.7rem; color: var(--text-dim); font-family: var(--font-mono);">${k.id}</span></td>
                <td>
                  <code style="font-size: 0.75rem;">${k.maskedKey}</code>
                  <button class="copy-key-btn" onclick="copyKeyToken('${k.maskedKey}')" title="Copy token">Copy</button>
                </td>
                <td>${statusPill}</td>
                <td style="font-family: var(--font-mono); font-size: 0.75rem;">${k.rpmLimit} RPM<br><span style="color: var(--text-dim);">${(k.tpmLimit / 1000).toFixed(0)}k TPM</span></td>
                <td style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent-cyan);">${k.currentRpm} RPM<br><span style="color: var(--text-dim);">${(k.currentTpm / 1000).toFixed(1)}k TPM</span></td>
                <td>${budgetHtml}</td>
                <td style="max-width: 140px;">${modelTags}</td>
                <td>
                  <div class="virtual-key-actions">
                    <button class="btn btn-sm btn-secondary" onclick="useVirtualKeyInPlayground('${k.id}')" title="Test in AI Playground">Test</button>
                    ${k.status === 'active' ? `<button class="btn btn-sm" onclick="revokeVirtualKey('${k.id}')" title="Revoke access">Revoke</button>` : ''}
                    <button class="btn btn-sm btn-secondary" onclick="deleteVirtualKey('${k.id}')" title="Delete key" style="color: var(--accent-rose);">&times;</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch {
      // Ignore polling errors
    }
  }

  // Modal event wiring
  const createKeyModal = document.getElementById('createKeyModal');
  const btnOpenModal = document.getElementById('btnOpenCreateKeyModal');
  const btnCloseModal = document.getElementById('btnCloseCreateKeyModal');
  const btnCancelModal = document.getElementById('btnCancelCreateKey');
  const btnSubmitModal = document.getElementById('btnSubmitCreateKey');
  const btnRefreshVk = document.getElementById('btnRefreshVirtualKeys');

  if (btnOpenModal && createKeyModal) {
    btnOpenModal.addEventListener('click', () => {
      createKeyModal.classList.add('active');
    });
  }

  function closeModal() {
    if (createKeyModal) createKeyModal.classList.remove('active');
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

  if (createKeyModal) {
    createKeyModal.addEventListener('click', (e) => {
      if (e.target === createKeyModal) closeModal();
    });
  }

  if (btnSubmitModal) {
    btnSubmitModal.addEventListener('click', async () => {
      const nameInput = document.getElementById('newKeyName');
      const rpmInput = document.getElementById('newKeyRpm');
      const tpmInput = document.getElementById('newKeyTpm');
      const budgetInput = document.getElementById('newKeyBudget');
      const modelsInput = document.getElementById('newKeyModels');
      const customInput = document.getElementById('newKeyCustom');

      if (!nameInput || !nameInput.value.trim()) {
        alert('Please enter a Key / Client Name.');
        return;
      }

      const payload = {
        name: nameInput.value.trim(),
        rpmLimit: rpmInput && rpmInput.value ? parseInt(rpmInput.value, 10) : 60,
        tpmLimit: tpmInput && tpmInput.value ? parseInt(tpmInput.value, 10) : 100000,
        maxBudgetUsd: budgetInput && budgetInput.value ? parseFloat(budgetInput.value) : undefined,
        allowedModels: modelsInput && modelsInput.value.trim() ? modelsInput.value.split(',').map(s => s.trim()).filter(Boolean) : ['*'],
        customKey: customInput && customInput.value.trim() ? customInput.value.trim() : undefined,
      };

      try {
        btnSubmitModal.disabled = true;
        btnSubmitModal.textContent = 'Generating...';

        const res = await fetch('/api/virtual-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json();
          nameInput.value = '';
          if (budgetInput) budgetInput.value = '';
          if (customInput) customInput.value = '';
          closeModal();
          await fetchAndRenderVirtualKeys();
          alert(`Virtual Key created successfully!\n\nClient Token: ${data.key.key}\n\nMake sure to copy it now.`);
        } else {
          const err = await res.json();
          alert(`Failed to create key: ${err.error || res.statusText}`);
        }
      } catch (err) {
        alert(`Network error: ${err.message}`);
      } finally {
        btnSubmitModal.disabled = false;
        btnSubmitModal.textContent = 'Generate Key';
      }
    });
  }

  if (btnRefreshVk) {
    btnRefreshVk.addEventListener('click', fetchAndRenderVirtualKeys);
  }

  // Window helper actions
  window.copyKeyToken = function (token) {
    navigator.clipboard.writeText(token).then(() => {
      alert(`Copied key token to clipboard: ${token}`);
    }).catch(() => {
      prompt('Copy this token:', token);
    });
  };

  window.useVirtualKeyInPlayground = function (keyId) {
    const key = cachedVirtualKeys.find(k => k.id === keyId);
    if (!key) return;

    // Switch to Playground tab
    const tabPlayground = document.getElementById('tabPlayground');
    if (tabPlayground) tabPlayground.click();

    // Select this key in Playground dropdown
    const vkSelect = document.getElementById('virtualKeySelect');
    if (vkSelect) {
      vkSelect.value = key.maskedKey;
    }

    // Set model if restricted
    if (key.allowedModels && !key.allowedModels.includes('*') && key.allowedModels.length > 0) {
      const modelSelect = document.getElementById('modelSelect');
      if (modelSelect) modelSelect.value = key.allowedModels[0];
    }
  };

  window.revokeVirtualKey = async function (keyId) {
    if (!confirm('Are you sure you want to revoke this virtual key? Client requests will immediately receive 401 Unauthorized.')) return;
    try {
      const res = await fetch(`/api/virtual-keys/${keyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'revoked' }),
      });
      if (res.ok) {
        fetchAndRenderVirtualKeys();
      }
    } catch (err) {
      alert(`Error revoking key: ${err.message}`);
    }
  };

  window.deleteVirtualKey = async function (keyId) {
    if (!confirm('Permanently delete this virtual key?')) return;
    try {
      const res = await fetch(`/api/virtual-keys/${keyId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchAndRenderVirtualKeys();
      }
    } catch (err) {
      alert(`Error deleting key: ${err.message}`);
    }
  };

  // ==========================================
  // FEATURE 7: RESPONSE CACHE CONTROLLER
  // ==========================================
  const cacheThresholdSlider = document.getElementById('cacheThresholdSlider');
  const cacheThresholdVal = document.getElementById('cacheThresholdVal');
  if (cacheThresholdSlider && cacheThresholdVal) {
    cacheThresholdSlider.addEventListener('input', () => {
      cacheThresholdVal.textContent = parseFloat(cacheThresholdSlider.value).toFixed(2);
    });
  }

  async function fetchAndRenderCache() {
    try {
      const res = await fetch('/api/cache/stats');
      if (!res.ok) return;
      const { stats } = await res.json();

      const elTotal = document.getElementById('cacheTotalEntries');
      const elRatio = document.getElementById('cacheHitRatio');
      const elCounts = document.getElementById('cacheHitCounts');
      const elMiss = document.getElementById('cacheMissCount');
      const elCost = document.getElementById('cacheSavedCost');
      const elTokens = document.getElementById('cacheSavedTokens');

      if (elTotal) elTotal.textContent = stats.totalEntries;
      if (elRatio) elRatio.textContent = `${Math.round(stats.hitRatio * 100)}% Hit Ratio`;
      if (elCounts) elCounts.textContent = `${stats.exactHits} / ${stats.semanticHits}`;
      if (elMiss) elMiss.textContent = `${stats.misses} Misses, ${stats.bypasses} Bypasses`;
      if (elCost) elCost.textContent = `$${stats.savedCostUsd.toFixed(5)}`;
      if (elTokens) elTokens.textContent = stats.savedTokens.toLocaleString();
    } catch {}
  }

  const btnSaveCache = document.getElementById('btnSaveCacheConfig');
  if (btnSaveCache) {
    btnSaveCache.addEventListener('click', async () => {
      const ttl = parseInt(document.getElementById('cacheTtlInput')?.value || '300', 10);
      const threshold = parseFloat(document.getElementById('cacheThresholdSlider')?.value || '0.82');
      const strategy = document.getElementById('cacheStrategySelect')?.value || 'lastQuestion';
      const enabled = document.getElementById('cacheEnableToggle')?.checked ?? true;

      try {
        await fetch('/api/cache/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ttlSeconds: ttl,
            semanticSimilarityThreshold: threshold,
            cacheKeyStrategy: strategy,
            enabled,
          }),
        });
        alert('Response cache configuration saved successfully!');
        fetchAndRenderCache();
      } catch (err) {
        alert(`Failed to save cache config: ${err.message}`);
      }
    });
  }

  const btnClearCache = document.getElementById('btnClearCache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      if (!confirm('Flush all in-memory exact and semantic cached responses?')) return;
      try {
        await fetch('/api/cache/clear', { method: 'POST' });
        fetchAndRenderCache();
      } catch (err) {
        alert(`Failed to clear cache: ${err.message}`);
      }
    });
  }

  const btnRefreshCache = document.getElementById('btnRefreshCache');
  if (btnRefreshCache) {
    btnRefreshCache.addEventListener('click', fetchAndRenderCache);
  }

  // ==========================================
  // FEATURE 8: GUARDRAILS CONTROLLER
  // ==========================================
  async function fetchAndRenderGuardrails() {
    try {
      const res = await fetch('/api/guardrails/config');
      if (!res.ok) return;
      const { config, metrics } = await res.json();

      const elInspected = document.getElementById('guardrailsTotalInspected');
      const elJailbreaks = document.getElementById('guardrailsBlockedJailbreaks');
      const elRedacted = document.getElementById('guardrailsRedactedPii');
      const elOutbound = document.getElementById('guardrailsOutboundCleaned');

      if (elInspected) elInspected.textContent = metrics.totalInspected;
      if (elJailbreaks) elJailbreaks.textContent = metrics.blockedJailbreaks;
      if (elRedacted) elRedacted.textContent = metrics.redactedPii;
      if (elOutbound) elOutbound.textContent = metrics.outboundPiiCleaned;
    } catch {}
  }

  const btnSaveGuardrailPolicies = document.getElementById('btnSaveGuardrailPolicies');
  if (btnSaveGuardrailPolicies) {
    btnSaveGuardrailPolicies.addEventListener('click', async () => {
      const piiAction = document.getElementById('guardrailPiiAction')?.value || 'mask';
      const jailbreakAction = document.getElementById('guardrailJailbreakAction')?.value || 'block';
      const outputMask = document.getElementById('guardrailOutputToggle')?.checked ?? true;

      try {
        await fetch('/api/guardrails/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pii: { action: piiAction },
            jailbreak: { action: jailbreakAction },
            outputSanitizer: { maskPii: outputMask },
          }),
        });
        alert('Guardrail safety policies updated successfully!');
        fetchAndRenderGuardrails();
      } catch (err) {
        alert(`Failed to update guardrails: ${err.message}`);
      }
    });
  }

  const btnRunGuardrailTest = document.getElementById('btnRunGuardrailTest');
  if (btnRunGuardrailTest) {
    btnRunGuardrailTest.addEventListener('click', async () => {
      const text = document.getElementById('guardrailTestInput')?.value || '';
      if (!text.trim()) {
        alert('Please enter some text to test');
        return;
      }

      try {
        const res = await fetch('/api/guardrails/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();

        const box = document.getElementById('guardrailTestResults');
        const badge = document.getElementById('guardrailVerdictBadge');
        const scoreText = document.getElementById('guardrailScoreText');
        const details = document.getElementById('guardrailDetailsText');
        const preview = document.getElementById('guardrailSanitizedPreview');

        if (box) box.style.display = 'block';

        if (badge) {
          badge.className = data.allowed ? 'badge badge-success' : 'badge badge-danger';
          badge.textContent = data.allowed ? 'PASSED / PERMITTED' : 'BLOCKED BY GUARDRAIL';
        }

        if (scoreText) {
          scoreText.textContent = `Injection Confidence: ${(data.jailbreakScore * 100).toFixed(0)}%`;
        }

        if (details) {
          let html = '';
          if (data.jailbreakDetected) {
            html += `<p style="color: #ef4444;"><strong>Jailbreak Detected:</strong> ${data.jailbreakSignals?.join(', ') || 'Triggered'}</p>`;
          }
          if (data.piiDetected) {
            html += `<p style="color: #f59e0b;"><strong>Sensitive Data Detected:</strong> ${data.piiMatches?.map(m => `${m.type} (${m.masked})`).join(', ')}</p>`;
          }
          if (!data.jailbreakDetected && !data.piiDetected) {
            html += `<p style="color: #10b981;">Clean prompt - zero security violations found.</p>`;
          }
          details.innerHTML = html;
        }

        if (preview) {
          preview.textContent = data.sanitizedText || text;
        }
      } catch (err) {
        alert(`Test failed: ${err.message}`);
      }
    });
  }

  // ==========================================
  // FEATURE 9: MUTATIONS & ALIASES CONTROLLER
  // ==========================================
  async function fetchAndRenderMutations() {
    try {
      const res = await fetch('/api/mutations/config');
      if (!res.ok) return;
      const { config } = await res.json();

      const tbody = document.getElementById('aliasesTableBody');
      if (tbody && config.modelAliases) {
        tbody.innerHTML = Object.entries(config.modelAliases)
          .map(([alias, target]) => `
            <tr>
              <td><code>${alias}</code></td>
              <td><strong>${target}</strong></td>
              <td>
                <button class="btn btn-sm btn-danger" onclick="window.deleteAlias('${alias}')">Remove</button>
              </td>
            </tr>
          `)
          .join('');
      }

      if (config.systemPromptDecoration) {
        const pInput = document.getElementById('mutationsSystemPrefix');
        const sInput = document.getElementById('mutationsSystemSuffix');
        const dToggle = document.getElementById('mutationsDecorateToggle');
        if (pInput && config.systemPromptDecoration.prefix !== undefined) pInput.value = config.systemPromptDecoration.prefix || '';
        if (sInput && config.systemPromptDecoration.suffix !== undefined) sInput.value = config.systemPromptDecoration.suffix || '';
        if (dToggle && config.systemPromptDecoration.enabled !== undefined) dToggle.checked = config.systemPromptDecoration.enabled;
      }
    } catch {}
  }

  window.deleteAlias = async function (alias) {
    if (!confirm(`Delete alias '${alias}'?`)) return;
    try {
      await fetch(`/api/mutations/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' });
      fetchAndRenderMutations();
    } catch (err) {
      alert(`Failed to delete alias: ${err.message}`);
    }
  };

  const btnAddAlias = document.getElementById('btnAddAlias');
  if (btnAddAlias) {
    btnAddAlias.addEventListener('click', async () => {
      const alias = document.getElementById('newAliasName')?.value.trim();
      const targetModel = document.getElementById('newAliasTarget')?.value.trim();
      if (!alias || !targetModel) {
        alert('Please provide both alias name and target model');
        return;
      }

      try {
        await fetch('/api/mutations/aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias, targetModel }),
        });
        document.getElementById('newAliasName').value = '';
        document.getElementById('newAliasTarget').value = '';
        fetchAndRenderMutations();
      } catch (err) {
        alert(`Failed to add alias: ${err.message}`);
      }
    });
  }

  const btnSaveMutationConfig = document.getElementById('btnSaveMutationConfig');
  if (btnSaveMutationConfig) {
    btnSaveMutationConfig.addEventListener('click', async () => {
      const reasoningEnabled = document.getElementById('mutationsReasoningToggle')?.checked ?? true;
      const schemaCleaning = document.getElementById('mutationsSchemaCleanToggle')?.checked ?? true;
      const prefix = document.getElementById('mutationsSystemPrefix')?.value || '';
      const suffix = document.getElementById('mutationsSystemSuffix')?.value || '';
      const decorateEnabled = document.getElementById('mutationsDecorateToggle')?.checked ?? false;

      try {
        await fetch('/api/mutations/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reasoningTranslation: { enabled: reasoningEnabled },
            parameterSanitization: { enabled: schemaCleaning, stripUnsupported: schemaCleaning },
            systemPromptDecoration: {
              enabled: decorateEnabled,
              prefix: prefix.trim() || undefined,
              suffix: suffix.trim() || undefined,
            },
          }),
        });
        alert('Mutation and prompt templating settings saved!');
        fetchAndRenderMutations();
      } catch (err) {
        alert(`Failed to save mutations config: ${err.message}`);
      }
    });
  }

  // Initial load
  loadStoredKeys();
  fetchAndRenderPool();
  fetchAndRenderResilience();
  fetchAndRenderTelemetry();
  fetchAndRenderPricing();
  fetchAndRenderVirtualKeys();
  fetchAndRenderCache();
  fetchAndRenderGuardrails();
  fetchAndRenderMutations();

  setInterval(fetchAndRenderPool, 2000);
  setInterval(fetchAndRenderResilience, 2000);
  setInterval(fetchAndRenderTelemetry, 2500);
  setInterval(fetchAndRenderVirtualKeys, 2500);
  setInterval(fetchAndRenderCache, 3000);
  setInterval(fetchAndRenderGuardrails, 3000);
});
