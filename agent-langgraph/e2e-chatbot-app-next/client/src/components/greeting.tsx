import { motion } from 'framer-motion';

export const Greeting = () => {
  return (
    <div
      key="overview"
      className="mx-auto mb-10 flex size-full max-w-3xl flex-col justify-center px-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="space-y-3 text-center"
      >
        <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/38">
          Local Coding Agent
        </div>
        <div className="text-3xl font-semibold tracking-[-0.04em] text-white/92 md:text-4xl">
          What should we change?
        </div>
        <div className="mx-auto max-w-xl text-sm text-white/48 md:text-base">
          Search the repo, inspect code, review diffs, and approve edits only when you want them applied.
        </div>
      </motion.div>
    </div>
  );
};
