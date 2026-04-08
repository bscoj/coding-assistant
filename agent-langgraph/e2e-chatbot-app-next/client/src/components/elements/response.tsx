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
        className="codex-response flex flex-col gap-4 text-[15px] leading-7 text-white/84 [&_code]:rounded-md [&_code]:bg-[#101827] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-[#f3f6fb] [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-white/[0.08] [&_pre]:bg-[#0b1220] [&_pre]:p-0 [&_pre_code]:block [&_pre_code]:bg-transparent [&_pre_code]:px-5 [&_pre_code]:py-4 [&_pre_code]:text-[#f3f6fb]"
        {...props}
      />
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
