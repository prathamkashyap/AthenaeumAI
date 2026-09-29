import { getBackgroundJobForUser, toPublicJob } from "../services/backgroundJobService.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * GET /api/v1/jobs/:id
 * Status of one background job, scoped to the authenticated learner.
 *
 * The lookup is by job id *and* owner, so an identifier is never sufficient to
 * read somebody else's job. An id that does not exist and an id owned by another
 * learner are both answered as "not found", so this endpoint cannot be used to
 * probe for the existence of other users' jobs.
 */
export const getBackgroundJobStatus = async (req, res, next) => {
  try {
    const job = await getBackgroundJobForUser(req.params.id, req.user._id);

    if (!job) {
      throw new NotFoundError("Background job not found");
    }

    res.json(toPublicJob(job));
  } catch (err) {
    next(err);
  }
};
