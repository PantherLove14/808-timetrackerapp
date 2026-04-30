import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import PageHeader, { Empty } from '../../components/PageHeader';
import { getBusinessColor, businessDot } from '../../lib/businessColor';
import { formatDate, formatDateTime } from '../../lib/format';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  approved: 'Approved',
  revision_requested: 'Revision'
};

const STATUS_BADGES = {
  todo: 'done',
  in_progress: 'pending',
  submitted: 'pending',
  approved: 'active',
  revision_requested: 'hold'
};

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

export default function AdminTasksPage() {
  const nav = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState('kanban'); // kanban | list

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [businessFilter, setBusinessFilter] = useState('all');
  const [otmFilter, setOtmFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const { data, error } = await supabase.rpc('list_admin_tasks');
      if (error) throw error;
      setTasks(data || []);
    } catch (e) {
      console.error(e);
      setLoadError(e.message || 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }

  // Build filter dropdown options from data
  const businessOptions = useMemo(() => {
    const m = new Map();
    tasks.forEach(t => { if (t.business_id) m.set(t.business_id, t.business_name); });
    return Array.from(m.entries()).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
  }, [tasks]);

  const otmOptions = useMemo(() => {
    const m = new Map();
    tasks.forEach(t => { if (t.assignee_id) m.set(t.assignee_id, t.assignee_name || '—'); });
    return Array.from(m.entries()).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
  }, [tasks]);

  const clientOptions = useMemo(() => {
    const m = new Map();
    tasks.forEach(t => { if (t.client_id) m.set(t.client_id, t.client_name || '—'); });
    return Array.from(m.entries()).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (businessFilter !== 'all' && t.business_id !== businessFilter) return false;
      if (otmFilter !== 'all' && t.assignee_id !== otmFilter) return false;
      if (clientFilter !== 'all' && t.client_id !== clientFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (q) {
        const blob = [t.title, t.description, t.business_name, t.client_name, t.assignee_name, t.creator_name]
          .filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, search, statusFilter, businessFilter, otmFilter, clientFilter, priorityFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 5;
      const pb = PRIORITY_ORDER[b.priority] ?? 5;
      if (pa !== pb) return pa - pb;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [filtered]);

  const stats = useMemo(() => ({
    total: filtered.length,
    todo: filtered.filter(t => t.status === 'todo').length,
    in_progress: filtered.filter(t => t.status === 'in_progress').length,
    submitted: filtered.filter(t => t.status === 'submitted').length,
    approved: filtered.filter(t => t.status === 'approved').length,
    revision_requested: filtered.filter(t => t.status === 'revision_requested').length
  }), [filtered]);

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setBusinessFilter('all');
    setOtmFilter('all');
    setClientFilter('all');
    setPriorityFilter('all');
  }

  const hasActiveFilters =
    search || statusFilter !== 'all' || businessFilter !== 'all' ||
    otmFilter !== 'all' || clientFilter !== 'all' || priorityFilter !== 'all';

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="All Tasks"
        subtitle="Every task across every business. Click any task to view, comment, and manage without switching accounts."
        right={<>
          <button className={`btn-sm ${view === 'kanban' ? 'ink' : ''}`} onClick={() => setView('kanban')}>KANBAN</button>{' '}
          <button className={`btn-sm ${view === 'list' ? 'ink' : ''}`} onClick={() => setView('list')}>LIST</button>{' '}
          <button className="btn-sm" onClick={load}>↻ Refresh</button>
        </>}
      />

      {loadError && (
        <div className="panel mb-5" style={{ borderColor: 'var(--crimson)', background: 'rgba(168,4,4,0.06)' }}>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-1">LOAD ERROR</div>
          <div className="text-sm">{loadError}</div>
        </div>
      )}

      {/* Filters */}
      <div className="panel mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="field-label">Search</label>
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, business, OTM…" />
          </div>
          <div>
            <label className="field-label">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="revision_requested">Revision</option>
            </select>
          </div>
          <div>
            <label className="field-label">Business</label>
            <select value={businessFilter} onChange={e => setBusinessFilter(e.target.value)}>
              <option value="all">All</option>
              {businessOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">OTM</label>
            <select value={otmFilter} onChange={e => setOtmFilter(e.target.value)}>
              <option value="all">All</option>
              {otmOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Client</label>
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
              <option value="all">All</option>
              {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Priority</label>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <div className="text-xs text-muted">
            Showing <strong>{filtered.length}</strong> of {tasks.length} tasks •
            {' '}{stats.todo} to do • {stats.in_progress} in progress • {stats.submitted} submitted • {stats.revision_requested} revision • {stats.approved} approved
          </div>
          {hasActiveFilters && (
            <button className="btn-sm" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="panel text-center py-12 text-muted font-display italic">Loading tasks…</div>
      ) : filtered.length === 0 ? (
        <div className="panel"><Empty>No tasks match these filters.</Empty></div>
      ) : view === 'kanban' ? (
        <KanbanView tasks={sorted} onOpen={id => nav(`/tasks/${id}`)} />
      ) : (
        <ListView tasks={sorted} onOpen={id => nav(`/tasks/${id}`)} />
      )}
    </div>
  );
}

// =============================================================================
// Kanban view
// =============================================================================
function KanbanView({ tasks, onOpen }) {
  const cols = [
    { key: 'todo', label: 'TO DO', color: 'var(--slate)' },
    { key: 'in_progress', label: 'IN PROGRESS', color: 'var(--crimson)' },
    { key: 'submitted', label: 'SUBMITTED', color: 'var(--warn)' },
    { key: 'approved', label: 'APPROVED', color: 'var(--ok)' }
  ];
  const revisions = tasks.filter(t => t.status === 'revision_requested');

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cols.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          return (
            <div key={col.key} className="bg-cream-deep border border-line rounded p-3 min-h-[400px]">
              <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center"
                   style={{ color: col.color }}>
                <span>{col.label}</span>
                <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{colTasks.length}</span>
              </div>
              {colTasks.length === 0 ? (
                <div className="text-xs text-muted italic text-center py-4">Empty</div>
              ) : colTasks.map(t => <KanbanCard key={t.id} task={t} onOpen={() => onOpen(t.id)} />)}
            </div>
          );
        })}
      </div>
      {revisions.length > 0 && (
        <div className="bg-cream-deep border border-crimson/40 rounded p-3 mt-4">
          <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center text-crimson">
            <span>REVISION REQUESTED</span>
            <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{revisions.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {revisions.map(t => <KanbanCard key={t.id} task={t} onOpen={() => onOpen(t.id)} />)}
          </div>
        </div>
      )}
    </>
  );
}

function KanbanCard({ task, onOpen }) {
  const color = getBusinessColor(task.business_id);
  const overdue = task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== 'approved';

  return (
    <div
      className="bg-paper border rounded p-3 mb-2 cursor-pointer hover:border-ink transition-all relative"
      style={{ borderLeftWidth: 3, borderLeftColor: color.hex, borderColor: 'var(--line)' }}
      onClick={onOpen}
    >
      {task.priority === 'urgent' && (
        <span className="absolute top-2 right-2 bg-crimson text-cream font-bebas text-[9px] tracking-widest px-2 py-0.5 rounded-full">URGENT</span>
      )}
      <div className="font-medium text-sm mb-1.5 leading-snug pr-12">{task.title}</div>
      <div className="text-[11px] text-muted flex justify-between gap-2 items-center mb-1">
        <span className="flex items-center gap-1.5 truncate">
          <span style={businessDot(task.business_id)} />
          <span className="font-bebas tracking-wider truncate" style={{ color: color.hex }}>{task.business_name || '—'}</span>
        </span>
      </div>
      <div className="text-[11px] text-muted flex justify-between gap-2 items-center">
        <span className="truncate">OTM: {task.assignee_name || 'Unassigned'}</span>
        <span className="truncate">Client: {task.client_name || '—'}</span>
      </div>
      {task.due_date && (
        <div className={`text-[11px] mt-1 ${overdue ? 'text-crimson font-medium' : 'text-muted'}`}>
          Due {formatDate(task.due_date)}{overdue ? ' (overdue)' : ''}
        </div>
      )}
      {task.status === 'revision_requested' && task.revision_reason && (
        <div className="text-[11px] bg-crimson/5 border border-crimson/20 text-crimson px-2 py-1 mt-2 rounded">
          <strong>Revision:</strong> {task.revision_reason}
        </div>
      )}
      <div className="flex gap-3 mt-2 text-[10px] text-muted">
        {task.comment_count > 0 && <span>💬 {task.comment_count}</span>}
        {task.attachment_count > 0 && <span>📎 {task.attachment_count}</span>}
      </div>
    </div>
  );
}

// =============================================================================
// List view
// =============================================================================
function ListView({ tasks, onOpen }) {
  return (
    <div className="panel p-0 overflow-hidden">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Business</th>
            <th>Client</th>
            <th>OTM</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Activity</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => {
            const color = getBusinessColor(t.business_id);
            const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== 'approved';
            return (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
                <td><strong>{t.title}</strong></td>
                <td>
                  <span className="flex items-center gap-1.5">
                    <span style={businessDot(t.business_id)} />
                    <span className="text-xs" style={{ color: color.hex }}>{t.business_name || '—'}</span>
                  </span>
                </td>
                <td>{t.client_name || '—'}</td>
                <td>{t.assignee_name || 'Unassigned'}</td>
                <td><span className={`badge ${STATUS_BADGES[t.status]}`}>{STATUS_LABELS[t.status]}</span></td>
                <td>
                  {t.priority === 'urgent' ? <span className="badge hold">URGENT</span> :
                   t.priority === 'high' ? <span className="badge pending">HIGH</span> :
                   t.priority === 'low' ? <span className="badge done">LOW</span> :
                   <span className="text-muted text-xs">Normal</span>}
                </td>
                <td className={overdue ? 'text-crimson' : ''}>{t.due_date ? formatDate(t.due_date) : '—'}</td>
                <td className="text-xs text-muted whitespace-nowrap">
                  {t.comment_count > 0 && <span>💬 {t.comment_count}</span>}
                  {t.comment_count > 0 && t.attachment_count > 0 && ' · '}
                  {t.attachment_count > 0 && <span>📎 {t.attachment_count}</span>}
                  {t.comment_count === 0 && t.attachment_count === 0 && '—'}
                </td>
                <td className="text-xs text-muted">{formatDateTime(t.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
