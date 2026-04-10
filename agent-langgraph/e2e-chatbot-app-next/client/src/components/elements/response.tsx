import { type ComponentProps, memo } from 'react';
import { DatabricksMessageCitationStreamdownIntegration } from '../databricks-message-citation';
import { Streamdown } from 'streamdown';

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  (props: ResponseProps) => {
    return (
      <Streamdown
        components={{
          a: DatabricksMessageCitationStreamdownIntegration,
        }}
        shikiTheme={['github-light', 'vesper']}
        className="codex-response flex flex-col gap-4 text-[15px] leading-7 text-white/84 [&_code]:rounded-md [&_code]:bg-[#1c1c1c] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-[#ffffff] [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-white/[0.08] [&_pre]:bg-[#101010] [&_pre]:p-0 [&_pre_code]:block [&_pre_code]:bg-transparent [&_pre_code]:px-5 [&_pre_code]:py-4 [&_pre_code]:text-[#ffffff] [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_li]:pl-1 [&_li>p]:my-0 [&_ul>li::marker]:text-white/50 [&_ol>li::marker]:text-white/50"
        {...props}
      />
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
