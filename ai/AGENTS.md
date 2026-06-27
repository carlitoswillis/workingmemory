# Agent Guidelines (AGENTS.md)

PURPOSE: This is the authoritative rulebook for AI assistants. It defines the 'how' and 'what' of the codebase.

## Project Context
- **Objective**: 
- **Stack**: 

## Architecture Constraints
- **API Structure**: 
- **Database**: 
- **Markdown Persistence**: All state must be tracked in `/ai`

## Coding Conventions
- **Explicit over Implicit**: Avoid hidden logic, reflection, or complex inheritance.
- **Verification First**: All changes must be verified via tests and the project's own startup scripts.
- **Compact Context**: Keep context files task-scoped and minimal.


## How to Navigate This Workspace (Priority Flow)
To minimize token waste and maximize focus, follow this priority sequence:
1. **START HERE**: Read `CURRENT_STATE.md`. It defines the current high-level objective (currently Phase 1: YouTube Integration).
2. **Operational Rules**: Read `AGENTS.md` (this file). Adhere strictly to these constraints.
3. **Task Details**: Read `TASKS.md` to see the specific backlog and active items. and implementation history.
4. **Self-Correction**: If you feel your understanding of the project state is out of sync, you may run `./scripts/ai-context.sh` to refresh your local context bundle.
