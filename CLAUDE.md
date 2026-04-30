# ai-callback-explorer — instructions for Claude Code

## Commit convention

Every commit authored by Claude **must** end with this trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Use a HEREDOC to preserve formatting:

```
git commit -m "$(cat <<'EOF'
<commit subject>

<optional body>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Apply this even for one-line commits — the trailer is part of the
project's authorship contract.
