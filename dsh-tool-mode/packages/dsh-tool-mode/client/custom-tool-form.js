/**
 * Create-tool tab source. This file is inlined into client/tool-insights.js by
 * the client generator; it is not loaded as a separate chunk.
 *
 * @module @try-works/dsh-tool-mode/client/custom-tool-form
 */

function createToolDefaults() {
  return {
    id: 'custom.',
    name: 'custom_',
    title: '',
    description: '',
    kind: 'http',
    method: 'GET',
    url: 'https://',
    headersText: '{\n  "Authorization": { "secret": "API_KEY" }\n}',
    extract: '',
    originsText: 'https://',
    promptTemplate: '',
    maxOutputTokens: '512',
    stepsText: '[\n  { "tool": "lang_detect", "args": { "text": "{{text}}" } }\n]',
    parametersText: '{\n  "type": "object",\n  "properties": {\n    "text": { "type": "string", "description": "Input text" }\n  },\n  "required": ["text"],\n  "additionalProperties": false\n}',
    outputSchemaText: '',
    timeoutMs: '15000',
    readOnly: true,
    agentExpose: true,
    mcpExpose: false,
    argsText: '{\n  "text": "hello"\n}',
    draftPrompt: '',
  }
}

function parseJsonField(text, label) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Build a draft from the form text fields. */
function customDraftFromForm(form) {
  const policy = {
    timeoutMs: Number(form.timeoutMs),
    readOnly: form.readOnly === true,
    networkOrigins: String(form.originsText).split(',').map(value => value.trim()).filter(value => value.length > 0),
    agentExpose: form.agentExpose === true,
    mcpExpose: form.mcpExpose === true,
  }
  let execution
  if (form.kind === 'http') {
    execution = {
      kind: 'http',
      http: {
        method: form.method,
        url: form.url,
        headers: parseJsonField(form.headersText, 'Headers'),
        ...form.extract.trim().length === 0 ? {} : { extract: form.extract.trim() },
      },
    }
  } else if (form.kind === 'prompt') {
    execution = {
      kind: 'prompt',
      prompt: {
        template: form.promptTemplate,
        ...form.maxOutputTokens.trim().length === 0 ? {} : { maxOutputTokens: Number(form.maxOutputTokens) },
      },
    }
  } else {
    execution = {
      kind: 'composite',
      composite: { steps: parseJsonField(form.stepsText, 'Steps') },
    }
  }
  return {
    id: form.id,
    name: form.name,
    title: form.title,
    description: form.description,
    parameters: parseJsonField(form.parametersText, 'Parameters'),
    ...form.outputSchemaText.trim().length === 0
      ? {}
      : { outputSchema: parseJsonField(form.outputSchemaText, 'Output schema') },
    execution,
    policy,
    examples: [],
  }
}

/**
 * Render a host-authored draft into the editable form fields.
 * @param {object} draft - validated custom-tool draft.
 * @returns {object} form state.
 */
function customFormFromDraft(draft) {
  const base = createToolDefaults()
  const execution = draft.execution || {}
  const policy = draft.policy || {}
  const form = {
    ...base,
    id: String(draft.id || ''),
    name: String(draft.name || ''),
    title: String(draft.title || ''),
    description: String(draft.description || ''),
    kind: String(execution.kind || 'http'),
    parametersText: JSON.stringify(draft.parameters || base.parametersText, null, 2),
    outputSchemaText: draft.outputSchema === undefined ? '' : JSON.stringify(draft.outputSchema, null, 2),
    timeoutMs: String(policy.timeoutMs ?? 15000),
    readOnly: policy.readOnly === true,
    agentExpose: policy.agentExpose !== false,
    mcpExpose: policy.mcpExpose === true,
    originsText: Array.isArray(policy.networkOrigins) ? policy.networkOrigins.join(', ') : '',
  }
  if (execution.kind === 'http' && execution.http) {
    form.method = String(execution.http.method || 'GET')
    form.url = String(execution.http.url || '')
    form.headersText = JSON.stringify(execution.http.headers || {}, null, 2)
    form.extract = String(execution.http.extract || '')
  } else if (execution.kind === 'prompt' && execution.prompt) {
    form.promptTemplate = String(execution.prompt.template || '')
    form.maxOutputTokens = String(execution.prompt.maxOutputTokens ?? 512)
  } else if (execution.kind === 'composite' && execution.composite) {
    form.stepsText = JSON.stringify(execution.composite.steps || [], null, 2)
  }
  return form
}

/** The Create tool tab. */
function CreateToolView(props) {
  const call = typeof props.call === 'function' ? props.call : null
  const [snapshot, setSnapshot] = React.useState({ status: call === null ? 'unavailable' : 'loading', tools: [], store: '' })
  const [form, setForm] = React.useState(createToolDefaults)
  const [issues, setIssues] = React.useState([])
  const [testResult, setTestResult] = React.useState(null)
  const [message, setMessage] = React.useState(null)
  const [busy, setBusy] = React.useState(false)

  const edit = (key, value) => setForm(previous => ({ ...previous, [key]: value }))

  const load = () => {
    if (call === null) return
    Promise.resolve(call('customToolsDescribe')).then(result => {
      const state = remoteState(result)
      setSnapshot({
        status: state.status,
        store: state.status === 'ready' ? String(state.value.store ?? '') : '',
        tools: state.status === 'ready' && Array.isArray(state.value.tools) ? state.value.tools : [],
        text: state.text,
      })
    }, error => setSnapshot({ status: 'error', tools: [], store: '', text: String((error && error.message) || error) }))
  }

  React.useEffect(load, [call])

  const run = async action => {
    setBusy(true)
    setIssues([])
    setTestResult(null)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage({ kind: 'error', text: String((error && error.message) || error) })
    } finally {
      setBusy(false)
    }
  }

  const draft = () => customDraftFromForm(form)
  const validate = () => run(async () => {
    const result = remoteState(await call('customToolsValidate', draft()))
    if (result.status !== 'ready') {
      setMessage({ kind: 'error', text: result.text || 'The host refused the validation.' })
      return
    }
    setIssues(Array.isArray(result.value.issues) ? result.value.issues : [])
    if (result.value.ok === true) setMessage({ kind: 'ok', text: 'Draft is valid.' })
  })
  const test = () => run(async () => {
    const result = remoteState(await call('customToolsTest', draft(), parseJsonField(form.argsText, 'Test arguments')))
    if (result.status !== 'ready') {
      setMessage({ kind: 'error', text: result.text || 'The host refused the test.' })
      return
    }
    setTestResult(result.value)
    if (result.value.ok !== true) setMessage({ kind: 'error', text: result.value.error?.message || 'The test failed.' })
  })
  const save = () => run(async () => {
    const result = remoteState(await call('customToolsSave', draft()))
    if (result.status !== 'ready') {
      setMessage({ kind: 'error', text: result.text || 'The host refused the save.' })
      return
    }
    setMessage({ kind: 'ok', text: `Saved version ${String(result.value.version)}.` })
    load()
  })
  const draftAgent = () => run(async () => {
    const result = remoteState(await call('customToolsDraft', form.draftPrompt))
    if (result.status !== 'ready') {
      setMessage({ kind: 'error', text: result.text || 'The host refused the draft.' })
      return
    }
    if (result.value.ok !== true || result.value.draft === undefined) {
      setMessage({ kind: 'error', text: result.value.error?.message || 'The model could not produce a valid draft.' })
      return
    }
    setForm(customFormFromDraft(result.value.draft))
    setMessage({ kind: 'ok', text: 'Draft loaded. Review every field before saving.' })
  })
  const toggle = tool => run(async () => {
    const result = remoteState(await call('customToolsSetEnabled', tool.id, tool.enabled !== true))
    if (result.status !== 'ready') setMessage({ kind: 'error', text: result.text || 'The host refused the change.' })
    load()
  })
  const remove = tool => run(async () => {
    if (typeof confirm === 'function' && !confirm(`Delete ${tool.title}?`)) return
    const result = remoteState(await call('customToolsDelete', tool.id))
    if (result.status !== 'ready') setMessage({ kind: 'error', text: result.text || 'The host refused the delete.' })
    load()
  })
  const editTool = tool => run(async () => {
    const result = remoteState(await call('customToolsGet', tool.id))
    if (result.status !== 'ready') {
      setMessage({ kind: 'error', text: result.text || 'The host refused the read.' })
      return
    }
    if (result.value === null || result.value === undefined) {
      setMessage({ kind: 'error', text: 'That custom tool is no longer in the store.' })
      return
    }
    setForm(customFormFromDraft(result.value))
    setMessage({ kind: 'ok', text: `Editing ${tool.title}. Saving creates version ${tool.version + 1}.` })
  })

  const fields = [
    ['Title', 'title', 'Human-readable title'],
    ['Name (wire)', 'name', 'custom_weather_lookup'],
    ['Description', 'description', 'When the agent should use it, and what it returns'],
    ['ID', 'id', 'custom.weather-lookup'],
  ]

  return h('div', { role: 'tabpanel', id: 'mti-panel-create', 'aria-labelledby': 'mti-tab-create' },
    h('div', { className: 'mti-head' },
      h('div', null,
        h('h2', { className: 'mti-title' }, 'Create tool'),
        h('p', { className: 'mti-sub' },
          'Author a custom tool, validate and test it, then save it. Agent exposure is on by default; ' +
          'MCP exposure is opt-in. Definitions live in this profile, not in the extension store.'))),
    snapshot.status === 'unavailable'
      ? Banner('Custom tools are not available on this host build.', 'mti-banner')
      : null,
    snapshot.status === 'error'
      ? Banner(snapshot.text || 'The custom-tool store could not be read.', 'mti-banner mti-banner-warn')
      : null,
    h('div', { className: 'mti-create-grid' },
      h('div', null,
        h('h3', { className: 'mti-create-heading' }, 'Definition'),
        ...fields.map(([label, key, hint]) => h('div', { className: 'mti-field mti-field-wide', key },
          h('label', { htmlFor: `mti-ct-${key}` }, label),
          h('input', {
            id: `mti-ct-${key}`,
            className: 'mti-input',
            value: form[key],
            placeholder: hint,
            onChange: event => edit(key, event.target.value),
          }))),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-ct-kind' }, 'Execution'),
          h('select', {
            id: 'mti-ct-kind', className: 'mti-select', value: form.kind,
            onChange: event => edit('kind', event.target.value),
          }, h('option', { value: 'http' }, 'HTTP request'), h('option', { value: 'prompt' }, 'Prompt'), h('option', { value: 'composite' }, 'Composite'))),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-ct-timeout' }, 'Timeout (ms)'),
          h('input', { id: 'mti-ct-timeout', className: 'mti-input', value: form.timeoutMs, onChange: event => edit('timeoutMs', event.target.value) })),
        h('div', { className: 'mti-field mti-field-wide' },
          h('label', { htmlFor: 'mti-ct-params' }, 'Input JSON Schema'),
          h('textarea', { id: 'mti-ct-params', className: 'mti-textarea', rows: 8, value: form.parametersText, onChange: event => edit('parametersText', event.target.value) })),
        form.kind === 'http' ? h('div', null,
          h('div', { className: 'mti-create-row' },
            h('div', { className: 'mti-field' },
              h('label', { htmlFor: 'mti-ct-method' }, 'Method'),
              h('select', { id: 'mti-ct-method', className: 'mti-select', value: form.method, onChange: event => edit('method', event.target.value) },
                ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => h('option', { value: method, key: method }, method)))),
            h('div', { className: 'mti-field mti-field-grow' },
              h('label', { htmlFor: 'mti-ct-url' }, 'URL template'),
              h('input', { id: 'mti-ct-url', className: 'mti-input', value: form.url, placeholder: 'https://api.example.com/{{text}}', onChange: event => edit('url', event.target.value) }))),
          h('div', { className: 'mti-field mti-field-wide' },
            h('label', { htmlFor: 'mti-ct-origins' }, 'Allowed HTTPS origins (comma separated)'),
            h('input', { id: 'mti-ct-origins', className: 'mti-input', value: form.originsText, onChange: event => edit('originsText', event.target.value) })),
          h('div', { className: 'mti-field mti-field-wide' },
            h('label', { htmlFor: 'mti-ct-headers' }, 'Headers (values may be { "secret": "NAME" })'),
            h('textarea', { id: 'mti-ct-headers', className: 'mti-textarea', rows: 5, value: form.headersText, onChange: event => edit('headersText', event.target.value) })),
          h('div', { className: 'mti-field' },
            h('label', { htmlFor: 'mti-ct-extract' }, 'Response dot-path (optional)'),
            h('input', { id: 'mti-ct-extract', className: 'mti-input', value: form.extract, onChange: event => edit('extract', event.target.value) })))
          : null,
        form.kind === 'prompt' ? h('div', null,
          h('div', { className: 'mti-field mti-field-wide' },
            h('label', { htmlFor: 'mti-ct-prompt' }, 'Prompt template'),
            h('textarea', { id: 'mti-ct-prompt', className: 'mti-textarea', rows: 6, value: form.promptTemplate, onChange: event => edit('promptTemplate', event.target.value) })),
          h('div', { className: 'mti-field' },
            h('label', { htmlFor: 'mti-ct-max' }, 'Max output tokens'),
            h('input', { id: 'mti-ct-max', className: 'mti-input', value: form.maxOutputTokens, onChange: event => edit('maxOutputTokens', event.target.value) })))
          : null,
        form.kind === 'composite' ? h('div', { className: 'mti-field mti-field-wide' },
          h('label', { htmlFor: 'mti-ct-steps' }, 'Steps (array of { tool, args, requiresApproval? })'),
          h('textarea', { id: 'mti-ct-steps', className: 'mti-textarea', rows: 8, value: form.stepsText, onChange: event => edit('stepsText', event.target.value) }))
          : null,
        h('div', { className: 'mti-field mti-field-wide' },
          h('label', { htmlFor: 'mti-ct-output' }, 'Output JSON Schema (optional)'),
          h('textarea', { id: 'mti-ct-output', className: 'mti-textarea', rows: 4, value: form.outputSchemaText, onChange: event => edit('outputSchemaText', event.target.value) })),
        h('div', { className: 'mti-create-checks' },
          h('label', null, h('input', { type: 'checkbox', checked: form.readOnly, onChange: event => edit('readOnly', event.target.checked) }), ' Read-only'),
          h('label', null, h('input', { type: 'checkbox', checked: form.agentExpose, onChange: event => edit('agentExpose', event.target.checked) }), ' Expose to agents'),
          h('label', null, h('input', { type: 'checkbox', checked: form.mcpExpose, onChange: event => edit('mcpExpose', event.target.checked) }), ' Expose over MCP'))),
      h('div', { className: 'mti-create-side' },
        h('h3', { className: 'mti-create-heading' }, 'Draft with agent'),
        h('p', { className: 'mti-help' }, 'Describe the tool. The host model returns a draft; it is never saved or run until you press Save.'),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-ct-draft' }, 'What should the tool do?'),
          h('textarea', { id: 'mti-ct-draft', className: 'mti-textarea', rows: 3, value: form.draftPrompt, placeholder: 'Look up the current weather for a city using our API.', onChange: event => edit('draftPrompt', event.target.value) })),
        h('div', { className: 'mti-create-actions' },
          h('button', { type: 'button', className: 'mti-button', disabled: busy || call === null, onClick: draftAgent }, 'Draft with agent')),
        h('h3', { className: 'mti-create-heading' }, 'Validate and test'),
        h('p', { className: 'mti-help' }, 'Nothing is saved until you press Save. Test runs the draft once with the sample arguments below.'),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-ct-args' }, 'Test arguments (JSON)'),
          h('textarea', { id: 'mti-ct-args', className: 'mti-textarea', rows: 5, value: form.argsText, onChange: event => edit('argsText', event.target.value) })),
        h('div', { className: 'mti-create-actions' },
          h('button', { type: 'button', className: 'mti-button', disabled: busy || call === null, onClick: validate }, 'Validate'),
          h('button', { type: 'button', className: 'mti-button', disabled: busy || call === null, onClick: test }, 'Test'),
          h('button', { type: 'button', className: 'mti-button mti-button-primary', disabled: busy || call === null, onClick: save }, 'Save')),
        message === null ? null : h('div', { className: message.kind === 'ok' ? 'mti-note mti-note-ok' : 'mti-note mti-note-error' }, message.text),
        issues.length === 0 ? null : h('ul', { className: 'mti-issues' }, issues.map(issue => h('li', { key: `${issue.path}:${issue.message}` }, `${issue.path}: ${issue.message}`))),
        testResult === null ? null : h('pre', { className: 'mti-pre' }, JSON.stringify(testResult, null, 2)),
        h('h3', { className: 'mti-create-heading' }, 'Saved custom tools'),
        snapshot.tools.length === 0
          ? h('p', { className: 'mti-help' }, 'No custom tools saved in this profile.')
          : h('div', { className: 'mti-create-list' }, snapshot.tools.map(tool => h('div', { className: 'mti-create-list-row', key: tool.id },
            h('div', null,
              h('div', { className: 'mti-create-list-title' }, tool.title),
              h('div', { className: 'mti-help mti-mono' }, `${tool.name} · ${tool.kind} · v${tool.version}${tool.mcpExpose ? ' · MCP' : ''}`)),
            h('div', { className: 'mti-create-list-actions' },
              h('button', { type: 'button', className: 'mti-button mti-button-small', disabled: busy, onClick: () => editTool(tool) }, 'Edit'),
              h('button', { type: 'button', className: 'mti-button mti-button-small', disabled: busy, onClick: () => toggle(tool) }, tool.enabled ? 'Disable' : 'Enable'),
              h('button', { type: 'button', className: 'mti-button mti-button-small', disabled: busy, onClick: () => remove(tool) }, 'Delete'))))))))
  )
}
