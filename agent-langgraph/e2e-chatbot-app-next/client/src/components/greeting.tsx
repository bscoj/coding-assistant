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
        <div className="text-3xl font-semibold tracking-[-0.04em] text-white/92 md:text-4xl">
          What are we working on today?
        </div>
        <div className="mx-auto max-w-xl text-sm text-white/48 md:text-base">
          Inspect the codebase, reason through the change, and allow edits only when you want them applied.
        </div>
      </motion.div>
    </div>
  );
};
