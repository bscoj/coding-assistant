import { cn } from '@/lib/utils';
import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { marked, type Token, type Tokens, type TokensList } from 'marked';
import { DatabricksMessageCitationStreamdownIntegration } from '../databricks-message-citation';
import { CodeBlock } from './code-block';

type ResponseProps = {
  children: string;
};

const RESPONSE_CLASS =
  'codex-response flex flex-col gap-4 text-[15px] leading-7 text-white/84';
const INLINE_CODE_CLASS =
  'rounded-md bg-[#1c1c1c] px-1.5 py-0.5 font-mono text-[0.92em] text-[#ffffff]';

function renderInlineTokens(tokens: Token[] | undefined, keyPrefix: string): ReactNode {
  if (!tokens || tokens.length === 0) return null;

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-inline-${index}`;

    switch (token.type) {
      case 'text':
      case 'escape':
        return <Fragment key={key}>{token.text}</Fragment>;
      case 'strong':
        return <strong key={key}>{renderInlineTokens(token.tokens, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInlineTokens(token.tokens, key)}</em>;
      case 'del':
        return <del key={key}>{renderInlineTokens(token.tokens, key)}</del>;
      case 'codespan':
        return (
          <code key={key} className={INLINE_CODE_CLASS}>
            {token.text}
          </code>
        );
      case 'br':
        return <br key={key} />;
      case 'link':
        return (
          <DatabricksMessageCitationStreamdownIntegration key={key} href={token.href}>
            {renderInlineTokens(token.tokens, key)}
          </DatabricksMessageCitationStreamdownIntegration>
        );
      case 'image':
        return (
          <img
            key={key}
            src={token.href}
            alt={token.text}
            title={token.title ?? undefined}
            className="my-3 max-w-full rounded-xl border border-white/[0.08]"
          />
        );
      default:
        return (
          <Fragment key={key}>
            {'tokens' in token && Array.isArray(token.tokens)
              ? renderInlineTokens(token.tokens, key)
              : 'text' in token
                ? String(token.text ?? '')
                : ''}
          </Fragment>
        );
    }
  });
}

function renderListItemContent(tokens: Token[], keyPrefix: string): ReactNode {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-item-${index}`;

    if (token.type === 'text' && token.tokens) {
      return <Fragment key={key}>{renderInlineTokens(token.tokens, key)}</Fragment>;
    }

    return <Fragment key={key}>{renderBlockToken(token, key)}</Fragment>;
  });
}

function renderTableCell(
  cell: Tokens.TableCell,
  key: string,
  header: boolean,
): ReactNode {
  const Tag = header ? 'th' : 'td';
  return (
    <Tag
      key={key}
      className={cn(
        header
          ? 'whitespace-nowrap px-4 py-2 text-left font-semibold text-sm'
          : 'px-4 py-2 text-sm',
      )}
      style={cell.align ? { textAlign: cell.align } : undefined}
    >
      {renderInlineTokens(cell.tokens, key)}
    </Tag>
  );
}

function renderBlockToken(token: Token, key: string): ReactNode {
  switch (token.type) {
    case 'space':
      return null;
    case 'hr':
      return <hr key={key} className="my-6 border-white/[0.08]" />;
    case 'heading': {
      const headingClass =
        token.depth === 1
          ? 'text-3xl font-semibold'
          : token.depth === 2
            ? 'text-2xl font-semibold'
            : token.depth === 3
              ? 'text-xl font-semibold'
              : token.depth === 4
                ? 'text-lg font-semibold'
                : 'text-base font-semibold';
      const Tag = `h${Math.min(Math.max(token.depth, 1), 6)}` as const;
      return (
        <Tag key={key} className={cn('mt-6 mb-2', headingClass)}>
          {renderInlineTokens(token.tokens, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="whitespace-pre-wrap">
          {renderInlineTokens(token.tokens, key)}
        </p>
      );
    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-4 border-white/[0.14] pl-4 text-white/72 italic"
        >
          <div className="flex flex-col gap-3">
            {token.tokens.map((child, index) => (
              <Fragment key={`${key}-blockquote-${index}`}>
                {renderBlockToken(child, `${key}-blockquote-${index}`)}
              </Fragment>
            ))}
          </div>
        </blockquote>
      );
    case 'list': {
      const ListTag = token.ordered ? 'ol' : 'ul';
      return (
        <ListTag
          key={key}
          className={cn(
            'my-3 space-y-1.5 pl-6',
            token.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {token.items.map((item, index) => (
            <li key={`${key}-list-${index}`} className="pl-1">
              {renderListItemContent(item.tokens, `${key}-list-${index}`)}
            </li>
          ))}
        </ListTag>
      );
    }
    case 'code':
      return (
        <CodeBlock
          key={key}
          code={token.text}
          language={token.lang || 'text'}
        />
      );
    case 'table':
      return (
        <div
          key={key}
          className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.02]"
        >
          <table className="w-full border-collapse">
            <thead className="bg-white/[0.04]">
              <tr className="border-b border-white/[0.08]">
                {token.header.map((cell, index) =>
                  renderTableCell(cell, `${key}-header-${index}`, true),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.08]">
              {token.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) =>
                    renderTableCell(
                      cell,
                      `${key}-row-${rowIndex}-cell-${cellIndex}`,
                      false,
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'html':
      return (
        <CodeBlock key={key} code={token.raw} language="html" />
      );
    default:
      return (
        <p key={key} className="whitespace-pre-wrap">
          {'tokens' in token && Array.isArray(token.tokens)
            ? renderInlineTokens(token.tokens, key)
            : 'text' in token
              ? String(token.text ?? '')
              : token.raw}
        </p>
      );
  }
}

function renderTokens(tokens: TokensList): ReactNode {
  return tokens.map((token, index) => (
    <Fragment key={`token-${index}`}>{renderBlockToken(token, `token-${index}`)}</Fragment>
  ));
}

export const Response = memo(
  ({ children }: ResponseProps) => {
    const markdown = children ?? '';
    const tokens = useMemo(() => marked.lexer(markdown), [markdown]);
    return <div className={RESPONSE_CLASS}>{tokens ? renderTokens(tokens) : markdown}</div>;
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
