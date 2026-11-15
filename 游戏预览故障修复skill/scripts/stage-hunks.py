"""Stage only the diff hunks of one file that mention any keyword (one commit per fix item when several
fixes touched the same file). Context-free hunks, applied to the index only; the working tree is untouched.

    python3 stage-hunks.py <file> <keyword> [keyword ...]
    git diff --cached <file>      # always review before committing

Tip: hunks are split at -U0, so two edits on adjacent lines land in one hunk; if a hunk mixes two items,
commit it with the first item and say so in the report.

WARNING (verified F004): -U0 hunks have no context, so `git apply --cached` places them by line number only.
Do not mix this with `git stash push --keep-index` / `stash pop` round-trips or with renames in the same
series: it has inserted one declaration twice (the final tree compiled, an intermediate commit did not) and
overwritten a renamed file's content. After the series, run `check-commits.sh <game> <base>`; when a stash
round-trip is unavoidable, grep the touched declarations in each commit (`git show <c>:<file> | grep -c ...`).
"""
import re
import subprocess
import sys

if len(sys.argv) < 3:
    sys.exit(__doc__)
path, keys = sys.argv[1], sys.argv[2:]
diff = subprocess.run(['git', 'diff', '-U0', '--', path], capture_output=True, text=True, check=True).stdout
if not diff:
    print('no changes in', path)
    sys.exit(0)
head, *hunks = re.split(r'(?m)^(?=@@ )', diff)
chosen = [h for h in hunks if any(k in h for k in keys)]
if not chosen:
    print('no hunks for', path, 'matching', keys)
    sys.exit(1)
subprocess.run(['git', 'apply', '--cached', '--unidiff-zero', '-'], input=head + ''.join(chosen), text=True, check=True)
print(path, len(chosen), 'of', len(hunks), 'hunks staged')
