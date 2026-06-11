import { z } from "zod";
import { createRouter, protectedMutation } from "../middleware";
import { cleanupUploadedFile } from "../services/uploadService";

export const uploadRouter = createRouter({
  cleanup: protectedMutation
    .input(z.object({ filePath: z.string() }))
    .mutation(async ({ input }) => {
      try {
        await cleanupUploadedFile(input.filePath);
        return { success: true };
      } catch (error) {
        return { success: false };
      }
    }),
});
