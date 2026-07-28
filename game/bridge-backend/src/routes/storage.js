import { Router } from "express";
import {
  getObjectEntityFile,
  streamObject,
  ObjectNotFoundError,
} from "../lib/objectStorage.js";

// Serves uploaded objects (news banners) from App Storage. Mounted at /objects,
// so req.path here is the tail (e.g. "/uploads/<id>"). Banners are public
// content, so there is no auth/ACL check on this read path.
export const storageRouter = Router();

storageRouter.get(/.*/, async (req, res) => {
  try {
    const file = await getObjectEntityFile(`/objects${req.path}`);
    await streamObject(file, res);
  } catch (e) {
    if (e instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "Not found." });
    }
    res.status(500).json({ error: "Failed to load object." });
  }
});
