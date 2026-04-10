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
    background: '#101010',
    color: '#ffffff',
    textShadow: 'none',
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] || {}),
    color: '#ffffff',
    textShadow: 'none',
    fontFamily:
      'JetBrains Mono, SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
  },
  'comment': {
    color: '#8b8b8b',
  },
  'prolog': {
    color: '#8b8b8b',
  },
  'doctype': {
    color: '#8b8b8b',
  },
  'cdata': {
    color: '#8b8b8b',
  },
  'punctuation': {
    color: '#a0a0a0',
  },
  'property': {
    color: '#ffffff',
  },
  'tag': {
    color: '#ffc799',
  },
  'boolean': {
    color: '#ffc799',
  },
  'number': {
    color: '#ffc799',
  },
  'constant': {
    color: '#ffc799',
  },
  'symbol': {
    color: '#99ffe4',
  },
  'deleted': {
    color: '#ff8080',
  },
  'selector': {
    color: '#99ffe4',
  },
  'attr-name': {
    color: '#ffc799',
  },
  'string': {
    color: '#99ffe4',
  },
  'char': {
    color: '#99ffe4',
  },
  'builtin': {
    color: '#ffc799',
  },
  'inserted': {
    color: '#99ffe4',
  },
  'operator': {
    color: '#a0a0a0',
  },
  'entity': {
    color: '#ffffff',
    cursor: 'help',
  },
  'url': {
    color: '#ffc799',
  },
  'atrule': {
    color: '#a0a0a0',
  },
  'attr-value': {
    color: '#99ffe4',
  },
  'keyword': {
    color: '#a0a0a0',
  },
  'function': {
    color: '#ffc799',
  },
  'class-name': {
    color: '#ffc799',
  },
  'regex': {
    color: '#99ffe4',
  },
  'important': {
    color: '#ffc799',
    fontWeight: '600',
  },
  'variable': {
    color: '#ffffff',
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
        'relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101010] text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]',
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
            background: '#101010',
            color: '#ffffff',
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
