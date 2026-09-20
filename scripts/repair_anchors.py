import glob
import re
import unicodedata
from difflib import SequenceMatcher

STEP_RE = re.compile(r'^\*\*(Étape \d+ — .+?)\*\*\s*:\s*(.*)$')
HEADING_RE = re.compile(r'^(#{1,6})\s+(.+?)\s*$')
LINK_RE = re.compile(r'\[([^\]]*)\]\(#([^)]+)\)')

def slugify(value, separator='-'):
    value = unicodedata.normalize('NFKD', value)
    value = value.encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    return re.sub(r'[-\s]+', separator, value)

for path in sorted(glob.glob('docs/*.md')):
    stem = path[len('docs/'):-3]
    if stem in ('index', 'dashboard'):
        continue
    with open(path, encoding='utf-8') as fh:
        lines = fh.read().splitlines(keepends=True)

    out = []
    for line in lines:
        m = STEP_RE.match(line.rstrip('\n'))
        if m is None:
            out.append(line)
            continue
        title = m.group(1)
        desc = m.group(2)
        out.append(f'### {title}\r\n')
        out.append('\r\n')
        if desc:
            out.append(f'{desc}\r\n')
    content = ''.join(out)

    headings = []
    h1_slug = None
    for line in content.splitlines():
        hm = HEADING_RE.match(line)
        if hm is None:
            continue
        level = len(hm.group(1))
        text = hm.group(2)
        slugs = []
        count = {}
        slugs.append(slugify(text))
        dup = count.get(slugs[0], 0)
        count[slugs[0]] = dup + 1
        if dup:
            slug = f'{slugs[0]}-{dup}'
        else:
            slug = slugs[0]
        headings.append((level, text, slug))
        if level == 1 and h1_slug is None:
            h1_slug = slug

    slug_to_title = {}
    for level, text, slug in headings:
        slug_to_title.setdefault(slug, []).append(text)

    counter = [0]
    skipped = []

    def repl(m):
        label = m.group(1)
        frag = m.group(2)
        norm = slugify(frag)
        candidates = slug_to_title.get(norm)
        target = norm if (candidates and len(candidates) == 1) else None

        if target is None:
            m2 = re.match(r'^(?:\d+-)?etape-(\d+)([_-]|$)', norm)
            if m2:
                n = m2.group(1)
                pills = [s for s in slug_to_title if re.match(rf'^etape-{n}\b', s)]
                titled = [s for s in pills if slug_to_title[s][0].startswith(f'Étape {n} —')]
                if titled:
                    pills = titled
                if len(pills) == 1:
                    target = pills[0]

        if target is None:
            pref = [s for s in slug_to_title if s.startswith(norm)]
            if len(pref) == 1:
                target = pref[0]

        if target is None:
            scored = sorted(
                ((SequenceMatcher(None, norm, s).ratio(), s) for s in slug_to_title),
                reverse=True,
            )
            best, best_slug = scored[0]
            if best >= 0.8 and len([x for x in scored if x[0] == best]) == 1:
                target = best_slug

        if target is None and 'Retour au début' in label and h1_slug:
            target = h1_slug

        if target:
            counter[0] += 1
            return f'[{label}](#{target})'
        skipped.append((label, frag, norm, candidates))
        return m.group(0)

    content = LINK_RE.sub(repl, content)
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(content)

    print(f'{stem}: steps -> headings, links: {counter[0]} rewritten, skipped {len(skipped)}')
    for sk in skipped:
        print(f'   SKIP: [{sk[0]}] (#{sk[1]}) norm={sk[2]} candidates={sk[3]}')