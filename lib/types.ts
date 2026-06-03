// Raw row types from SQL queries

export interface ProjectRow {
  id: string;
  worktree: string;
  vcs: string | null;
  name: string | null;
  icon_url: string | null;
  icon_color: string | null;
  time_created: number;
  time_updated: number;
  time_initialized: number | null;
  sandboxes: string;
  commands: string | null;
  icon_url_override: string | null;
}

export interface SessionRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  share_url: string | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  summary_diffs: string | null;
  revert: string | null;
  permission: string | null;
  time_created: number;
  time_updated: number;
  time_compacting: number | null;
  time_archived: number | null;
  workspace_id: string | null;
  path: string | null;
  agent: string | null;
  model: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  metadata: string | null;
}

export interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface TodoRow {
  session_id: string;
  content: string;
  status: string;
  priority: string;
  position: number;
  time_created: number;
  time_updated: number;
}

// Derived / computed types for display

export interface DirectoryOverviewRow {
  directory: string;
  total: number;
  active: number;
  archived: number;
  main_count: number;
  sub_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost: number;
  last_active: number;
}

export interface SessionListRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_archived: number | null;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  parent_id: string | null;
  message_count: number;
}

export interface SessionDetail {
  session: SessionRow;
  message_count: number;
  todos: TodoSummary;
}

export interface TodoSummary {
  completed: number;
  in_progress: number;
  pending: number;
  total: number;
}

export interface ModelStat {
  model: string;
  count: number;
}

export interface ModelCostRow {
  model: string;
  totalCost: number;
  sessionCount: number;
}

export interface AgentStat {
  agent: string;
  count: number;
}

export interface ProviderStat {
  provider: string;
  count: number;
}

export interface DbStats {
  projects: number;
  sessions: number;
  active_sessions: number;
  archived_sessions: number;
  messages: number;
  parts: number;
  todos: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  total_cost: number;
  oldest_session: number | null;
  newest_session: number | null;
  directories: number;
  daily_avg: number;
  weekly_avg: number;
  monthly_avg: number;
  total_days: number;
  top_model: { model: string; count: number } | null;
  top_provider: { provider: string; count: number } | null;
  version_min: string | null;
  version_max: string | null;
}
