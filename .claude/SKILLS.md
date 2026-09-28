# Skills instaladas neste repositório

Copiadas em 2026-09-28 para `.claude/skills/`, para que toda sessão do Claude Code neste repo as carregue.

| Origem | Commit | O que entrou |
|---|---|---|
| anthropics/skills | 3337550 | todas (docx, pdf, pptx, xlsx, frontend-design, skill-creator, mcp-builder, claude-api, canvas-design, etc.) |
| anthropics/claude-code plugins/frontend-design | 8364969 | idêntica à frontend-design de anthropics/skills |
| obra/superpowers | 8ca22db | todas as skills + hook SessionStart (`.claude/hooks/superpowers-session-start`) |
| nextlevelbuilder/ui-ux-pro-max-skill | 09170ee | ui-ux-pro-max, design, design-system, brand, banner-design, slides, ui-styling |
| mrgoonie/claudekit-skills | 80113d8 | todas, incluindo threejs, exceto as listadas abaixo |
| MuhiminOsim/code-refactoring-skill | 90fa640 | como `code-refactoring` |

Ajustes:
- claudekit `code-review` renomeada para `claudekit-code-review` (não sobrepõe o /code-review nativo).
- code-refactoring-skill renomeada de `refactor` para `code-refactoring`.
- Referências `superpowers:<skill>` trocadas por `<skill>` (aqui não há namespace de plugin).

Deixadas de fora (claudekit): frontend-design, mcp-builder, skill-creator, document-skills e ui-styling (duplicadas; ficou a versão da Anthropic / ui-ux-pro-max), ai-multimodal (exige GEMINI_API_KEY), template-skill (modelo vazio).

`.claude/` está no .dockerignore e no .squarecloudignore, não vai para o deploy.
