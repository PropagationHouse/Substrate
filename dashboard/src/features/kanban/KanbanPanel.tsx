import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { KanbanTask, TaskStatus } from './types';
import { useKanban } from './hooks/useKanban';
import { useMediaSuiteTasks } from './hooks/useMediaSuiteTasks';
import { useCircuitsTasks } from './hooks/useCircuitsTasks';
import { useProposals } from './hooks/useProposals';
import { KanbanHeader, type TaskSourceFilter } from './KanbanHeader';
import { KanbanBoard } from './KanbanBoard';
import { CreateTaskDialog } from './CreateTaskDialog';
import { TaskDetailDrawer } from './TaskDetailDrawer';

interface KanbanPanelProps {
  /** If set, auto-open the drawer for this task ID on mount. */
  initialTaskId?: string | null;
  /** Called after the initial task drawer has been opened (to clear the ID). */
  onInitialTaskConsumed?: () => void;
}

/**
 * Main Kanban panel — replaces the placeholder from Wave 1.
 * Full board with header, columns, create dialog, and detail drawer.
 */
export function KanbanPanel({ initialTaskId, onInitialTaskConsumed }: KanbanPanelProps = {}) {
  const {
    tasks,
    loading,
    error,
    filters,
    setFilters,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    reorderTask,
    boardColumns,
    executeTask,
    approveTask,
    rejectTask,
    abortTask,
  } = useKanban();

  const {
    proposals,
    pendingCount: pendingProposalCount,
    approveProposal,
    rejectProposal,
  } = useProposals();

  // Media Suite external tasks (merged into the board)
  const { tasks: mediaSuiteTasks, available: mediaSuiteAvailable, projectName: msProjectName } = useMediaSuiteTasks();

  // Circuit tasks (agent-automated scheduled tasks)
  const { tasks: circuitTasks, available: circuitsAvailable } = useCircuitsTasks();

  // Source filter state
  const [sourceFilter, setSourceFilter] = useState<TaskSourceFilter>('all');

  // Merge all task sources: native + media suite + circuits
  const allTasks = useMemo(() => [
    ...tasks,
    ...(mediaSuiteAvailable ? mediaSuiteTasks : []),
    ...(circuitsAvailable ? circuitTasks : []),
  ], [tasks, mediaSuiteTasks, mediaSuiteAvailable, circuitTasks, circuitsAvailable]);

  // Filter by source
  const filteredTasks = useMemo(() => {
    if (sourceFilter === 'all') return allTasks;
    if (sourceFilter === 'media-suite') return allTasks.filter(t => t.id.startsWith('ms:'));
    if (sourceFilter === 'agent') return allTasks.filter(t => t.createdBy?.startsWith('agent:') || t.assignee?.startsWith('agent:'));
    // human = native tasks created by operator (not agent, not media suite)
    return allTasks.filter(t => !t.id.startsWith('ms:') && t.createdBy === 'operator' && !t.assignee?.startsWith('agent:'));
  }, [allTasks, sourceFilter]);

  // Combined tasksByStatus that includes Media Suite items
  const mergedTasksByStatus = useCallback((status: TaskStatus): KanbanTask[] => {
    return filteredTasks.filter(t => t.status === status).sort((a, b) => a.columnOrder - b.columnOrder);
  }, [filteredTasks]);

  // Combined status counts
  const mergedStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of filteredTasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [filteredTasks]);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const consumedRef = useRef<string | null>(null);

  // Auto-open drawer for initialTaskId
  useEffect(() => {
    if (!initialTaskId || initialTaskId === consumedRef.current) return;
    const match = tasks.find((t) => t.id === initialTaskId);
    if (match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time sync from prop
      setSelectedTask(match);
      consumedRef.current = initialTaskId;
      onInitialTaskConsumed?.();
    }
  }, [initialTaskId, tasks, onInitialTaskConsumed]);

  /* ── Card click → open drawer ── */
  const handleCardClick = useCallback((task: KanbanTask) => {
    setSelectedTask(task);
  }, []);

  /* ── Close drawer ── */
  const handleCloseDrawer = useCallback(() => {
    setSelectedTask(null);
  }, []);

  /* ── Create handler ── */
  const handleCreate = useCallback(async (payload: Parameters<typeof createTask>[0]) => {
    await createTask(payload);
  }, [createTask]);

  /* ── Update handler (refreshes selected task) ── */
  const handleUpdate = useCallback(async (...args: Parameters<typeof updateTask>) => {
    const updated = await updateTask(...args);
    setSelectedTask(updated);
    return updated;
  }, [updateTask]);

  /* ── Delete handler ── */
  const handleDelete = useCallback(async (id: string) => {
    await deleteTask(id);
  }, [deleteTask]);

  /* ── Open create dialog ── */
  const openCreateDialog = useCallback(() => {
    setCreateOpen(true);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header with search, filters, stats, + New Task */}
      <KanbanHeader
        filters={filters}
        onFiltersChange={setFilters}
        statusCounts={mergedStatusCounts}
        onCreateTask={openCreateDialog}
        proposals={proposals}
        pendingProposalCount={pendingProposalCount}
        onApproveProposal={async (id) => { await approveProposal(id); await fetchTasks(); }}
        onRejectProposal={async (id) => { await rejectProposal(id); }}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        mediaSuiteLabel={msProjectName}
      />

      {/* Board body */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 pb-4">
        <KanbanBoard
          tasksByStatus={mergedTasksByStatus}
          onCardClick={handleCardClick}
          loading={loading}
          error={error}
          onRetry={() => fetchTasks()}
          hasAnyTasks={filteredTasks.length > 0}
          onCreateTask={openCreateDialog}
          reorderTask={reorderTask}
          boardColumns={boardColumns}
        />
      </div>

      {/* Create Task Modal */}
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />

      {/* Task Detail Drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        onClose={handleCloseDrawer}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onExecute={executeTask}
        onApprove={approveTask}
        onReject={rejectTask}
        onAbort={abortTask}
      />
    </div>
  );
}
