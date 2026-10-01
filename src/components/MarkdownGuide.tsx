import { Fragment, ReactNode } from 'react';

type GuideBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'ordered-list'; items: string[]; start: number }
  | { type: 'unordered-list'; items: string[] };

const inlineContent = (content: string): ReactNode[] =>
  content
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );

const parseGuide = (markdown: string): GuideBlock[] => {
  const blocks: GuideBlock[] = [];
  const lines = markdown.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: heading[2],
      });
      continue;
    }

    const orderedItem = /^(\d+)\.\s+(.+)$/.exec(line);
    if (orderedItem) {
      const start = Number(orderedItem[1]);
      const items = [orderedItem[2]];
      while (index + 1 < lines.length) {
        const nextItem = /^\s*\d+\.\s+(.+)$/.exec(lines[index + 1]);
        if (!nextItem) break;
        items.push(nextItem[1]);
        index += 1;
      }
      blocks.push({ type: 'ordered-list', items, start });
      continue;
    }

    const unorderedItem = /^-\s+(.+)$/.exec(line);
    if (unorderedItem) {
      const items = [unorderedItem[1]];
      while (index + 1 < lines.length) {
        const nextItem = /^\s*-\s+(.+)$/.exec(lines[index + 1]);
        if (!nextItem) break;
        items.push(nextItem[1]);
        index += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    blocks.push({ type: 'paragraph', content: line });
  }

  return blocks;
};

export function MarkdownGuide({ markdown }: { markdown: string }) {
  const blocks = parseGuide(markdown);

  return (
    <article className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h2
                key={index}
                className="text-2xl font-bold text-gray-950 dark:text-gray-50"
              >
                {inlineContent(block.content)}
              </h2>
            );
          }
          return (
            <h3
              key={index}
              className="border-l-4 border-guardsman-red-500 pl-3 pt-0 text-lg font-semibold text-gray-950 dark:border-guardsman-red-400 dark:text-gray-50"
            >
              {inlineContent(block.content)}
            </h3>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={index} start={block.start} className="space-y-3">
              {block.items.map((item, itemIndex) => (
                <li
                  key={itemIndex}
                  className="flex items-start gap-3 leading-6"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-guardsman-red-600 text-xs font-bold text-white shadow-sm dark:bg-guardsman-red-500"
                  >
                    {block.start + itemIndex}
                  </span>
                  <span className="min-w-0 flex-1">{inlineContent(item)}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'unordered-list') {
          return (
            <ul
              key={index}
              className="space-y-2 rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/60"
            >
              {block.items.map((item, itemIndex) => (
                <li
                  key={itemIndex}
                  className="flex items-start gap-3 leading-6"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2.5 size-2 shrink-0 rounded-full bg-gold-drop-500 ring-4 ring-gold-drop-100 dark:bg-gold-drop-400 dark:ring-gold-drop-950"
                  />
                  <span className="min-w-0 flex-1">{inlineContent(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="leading-6">
            {inlineContent(block.content)}
          </p>
        );
      })}
    </article>
  );
}
