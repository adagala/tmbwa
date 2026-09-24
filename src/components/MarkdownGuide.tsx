import { Fragment, ReactNode } from 'react';

type GuideBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'ordered-list'; items: string[] }
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

    const orderedItem = /^\d+\.\s+(.+)$/.exec(line);
    if (orderedItem) {
      const items = [orderedItem[1]];
      while (index + 1 < lines.length) {
        const nextItem = /^\s*\d+\.\s+(.+)$/.exec(lines[index + 1]);
        if (!nextItem) break;
        items.push(nextItem[1]);
        index += 1;
      }
      blocks.push({ type: 'ordered-list', items });
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
    <article className="space-y-4 text-gray-700 dark:text-gray-300">
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
              className="pt-4 text-lg font-semibold text-gray-950 dark:text-gray-50"
            >
              {inlineContent(block.content)}
            </h3>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={index} className="ml-6 list-decimal space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-1 leading-7">
                  {inlineContent(item)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={index} className="ml-6 list-disc space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-1 leading-7">
                  {inlineContent(item)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="leading-7">
            {inlineContent(block.content)}
          </p>
        );
      })}
    </article>
  );
}
