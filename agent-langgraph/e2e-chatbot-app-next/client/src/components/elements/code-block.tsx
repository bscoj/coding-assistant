import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';
import { createContext } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

const darkCodeTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] || {}),
    background: '#101214',
    color: '#f3f5f7',
    textShadow: 'none',
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] || {}),
    color: '#f3f5f7',
    textShadow: 'none',
    fontFamily:
      'JetBrains Mono, SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
  },
  'comment': {
    color: '#7d8693',
  },
  'prolog': {
    color: '#7d8693',
  },
  'doctype': {
    color: '#7d8693',
  },
  'cdata': {
    color: '#7d8693',
  },
  'punctuation': {
    color: '#a7b0bc',
  },
  'property': {
    color: '#f3f5f7',
  },
  'tag': {
    color: '#8ce6b0',
  },
  'boolean': {
    color: '#ffd58f',
  },
  'number': {
    color: '#ffd58f',
  },
  'constant': {
    color: '#ffd58f',
  },
  'symbol': {
    color: '#99ffe4',
  },
  'deleted': {
    color: '#ff8b8b',
  },
  'selector': {
    color: '#99ffe4',
  },
  'attr-name': {
    color: '#8ce6b0',
  },
  'string': {
    color: '#99ffe4',
  },
  'char': {
    color: '#99ffe4',
  },
  'builtin': {
    color: '#9fd4ff',
  },
  'inserted': {
    color: '#99ffe4',
  },
  'operator': {
    color: '#a7b0bc',
  },
  'entity': {
    color: '#f3f5f7',
    cursor: 'help',
  },
  'url': {
    color: '#8ce6b0',
  },
  'atrule': {
    color: '#8ce6b0',
  },
  'attr-value': {
    color: '#99ffe4',
  },
  'keyword': {
    color: '#8ce6b0',
  },
  'function': {
    color: '#ffc799',
  },
  'class-name': {
    color: '#9fd4ff',
  },
  'regex': {
    color: '#99ffe4',
  },
  'important': {
    color: '#ffd58f',
    fontWeight: '600',
  },
  'variable': {
    color: '#f3f5f7',
  },
  'bold': {
    fontWeight: '700',
  },
  'italic': {
    fontStyle: 'italic',
  },
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
});

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  children?: ReactNode;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => (
  <CodeBlockContext.Provider value={{ code }}>
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101214] text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]',
        className,
      )}
      {...props}
    >
      <div className="relative">
        <SyntaxHighlighter
          className="overflow-hidden dark:hidden"
          codeTagProps={{
            className: 'font-mono text-sm',
          }}
          customStyle={{
            margin: 0,
            padding: '1rem 1.1rem',
            fontSize: '0.84rem',
            lineHeight: '1.65',
            background: '#f7f8fb',
            color: '#0f172a',
            overflowX: 'auto',
            overflowWrap: 'normal',
            wordBreak: 'normal',
          }}
          language={language}
          lineNumberStyle={{
            color: 'hsl(var(--muted-foreground))',
            paddingRight: '1rem',
            minWidth: '2.5rem',
          }}
          showLineNumbers={showLineNumbers}
          style={oneLight}
        >
          {code}
        </SyntaxHighlighter>
        <SyntaxHighlighter
          className="hidden overflow-hidden dark:block"
          codeTagProps={{
            className: 'font-mono text-sm',
          }}
          customStyle={{
            margin: 0,
            padding: '1.05rem 1.15rem',
            fontSize: '0.88rem',
            lineHeight: '1.72',
            background: '#101214',
            color: '#f3f5f7',
            overflowX: 'auto',
            overflowWrap: 'normal',
            wordBreak: 'normal',
          }}
          language={language}
          lineNumberStyle={{
            color: '#505050',
            paddingRight: '1rem',
            minWidth: '2.5rem',
          }}
          showLineNumbers={showLineNumbers}
          style={darkCodeTheme}
        >
          {code}
        </SyntaxHighlighter>
        {children && (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  </CodeBlockContext.Provider>
);
