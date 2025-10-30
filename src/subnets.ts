import { Router } from "express";
import { SubNetRole, SubNetVisibility } from "./generated/prisma/index.js";
import { auth } from "./misc.js";
import { prismaClient as prisma } from "./prismaClient.js";

const router = Router();

// Helper function to generate URL-friendly slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars except spaces and hyphens
    .replace(/[\s_-]+/g, '-') // Replace spaces, underscores with single hyphen
    .replace(/^-+|-+$/g, ''); // Trim hyphens from start and end
}

// Helper function to ensure unique slug for a user
async function ensureUniqueSlug(ownerId: string, baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  
  while (true) {
    const existing = await prisma.subNet.findUnique({
      where: {
        ownerId_slug: {
          ownerId,
          slug
        }
      }
    });
    
    // If no existing subnet found, or it's the one we're updating, slug is unique
    if (!existing || (excludeId && existing.id === excludeId)) {
      return slug;
    }
    
    // Try next variant
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

// --- Create SubNet ---
router.post("/subnets", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const userId = (req.user as any).id;
  const { name, description, visibility, parentId } = req.body;

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Name is required" });
  }

  // Validate visibility if provided
  const validVisibilities: SubNetVisibility[] = ["PRIVATE", "ACQUAINTANCES", "CONNECTIONS", "PUBLIC"];
  const subnetVisibility = visibility || "PRIVATE";
  if (!validVisibilities.includes(subnetVisibility)) {
    return res.status(400).json({ error: "Invalid visibility value" });
  }

  try {
    // If parentId is provided, verify it exists and belongs to the user
    if (parentId) {
      const parent = await prisma.subNet.findUnique({
        where: { id: parentId }
      });

      if (!parent) {
        return res.status(404).json({ error: "Parent subnet not found" });
      }

      if (parent.ownerId !== userId) {
        return res.status(403).json({ error: "Parent subnet does not belong to you" });
      }
    }

    // Generate unique slug
    const baseSlug = generateSlug(name);
    const slug = await ensureUniqueSlug(userId, baseSlug);

    // Get the highest ordering value for this user's subnets (for the same parent)
    const lastSubnet = await prisma.subNet.findFirst({
      where: {
        ownerId: userId,
        parentId: parentId || null
      },
      orderBy: {
        ordering: 'desc'
      },
      select: {
        ordering: true
      }
    });

    const ordering = lastSubnet ? lastSubnet.ordering + 1 : 0;

    // Create the subnet
    const subnet = await prisma.subNet.create({
      data: {
        name: name.trim(),
        slug,
        description: description || null,
        visibility: subnetVisibility,
        ownerId: userId,
        parentId: parentId || null,
        ordering
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json(subnet);
  } catch (error) {
    console.error("Error creating subnet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- List SubNets ---
router.get("/subnets", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const userId = (req.user as any).id;

  try {
    // Get all subnets owned by the authenticated user
    const subnets = await prisma.subNet.findMany({
      where: {
        ownerId: userId
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        parent: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        children: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      },
      orderBy: [
        { parentId: 'asc' },
        { ordering: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json(subnets);
  } catch (error) {
    console.error("Error listing subnets:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Get Single SubNet ---
router.get("/subnets/:id", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const userId = (req.user as any).id;
  const { id } = req.params;

  try {
    const subnet = await prisma.subNet.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        parent: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        children: {
          select: {
            id: true,
            name: true,
            slug: true
          },
          orderBy: {
            ordering: 'asc'
          }
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    });

    if (!subnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    // Only the owner can view the subnet details
    if (subnet.ownerId !== userId) {
      return res.status(403).json({ error: "You do not have permission to view this subnet" });
    }

    res.json(subnet);
  } catch (error) {
    console.error("Error getting subnet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Update SubNet ---
router.patch("/subnets/:id", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const userId = (req.user as any).id;
  const { id } = req.params;
  const { name, description, visibility, ordering, parentId } = req.body;

  try {
    // Check if subnet exists and belongs to user
    const existingSubnet = await prisma.subNet.findUnique({
      where: { id }
    });

    if (!existingSubnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    if (existingSubnet.ownerId !== userId) {
      return res.status(403).json({ error: "You do not have permission to update this subnet" });
    }

    // Build update data object
    const updateData: any = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "Name must be a non-empty string" });
      }
      updateData.name = name.trim();
      
      // Generate new slug if name changed
      const baseSlug = generateSlug(name);
      updateData.slug = await ensureUniqueSlug(userId, baseSlug, id);
    }

    if (description !== undefined) {
      updateData.description = description || null;
    }

    if (visibility !== undefined) {
      const validVisibilities: SubNetVisibility[] = ["PRIVATE", "ACQUAINTANCES", "CONNECTIONS", "PUBLIC"];
      if (!validVisibilities.includes(visibility)) {
        return res.status(400).json({ error: "Invalid visibility value" });
      }
      updateData.visibility = visibility;
    }

    if (ordering !== undefined) {
      if (typeof ordering !== "number") {
        return res.status(400).json({ error: "Ordering must be a number" });
      }
      updateData.ordering = ordering;
    }

    if (parentId !== undefined) {
      // Allow null to remove parent
      if (parentId === null) {
        updateData.parentId = null;
      } else {
        // Verify parent exists and belongs to user
        const parent = await prisma.subNet.findUnique({
          where: { id: parentId }
        });

        if (!parent) {
          return res.status(404).json({ error: "Parent subnet not found" });
        }

        if (parent.ownerId !== userId) {
          return res.status(403).json({ error: "Parent subnet does not belong to you" });
        }

        // Prevent circular hierarchy
        if (parentId === id) {
          return res.status(400).json({ error: "A subnet cannot be its own parent" });
        }

        // Check if the new parent is a descendant of this subnet
        let currentParent = parent;
        while (currentParent.parentId) {
          if (currentParent.parentId === id) {
            return res.status(400).json({ error: "Cannot create circular hierarchy" });
          }
          const nextParent = await prisma.subNet.findUnique({
            where: { id: currentParent.parentId }
          });
          if (!nextParent) break;
          currentParent = nextParent;
        }

        updateData.parentId = parentId;
      }
    }

    // Update the subnet
    const updatedSubnet = await prisma.subNet.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        parent: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    res.json(updatedSubnet);
  } catch (error) {
    console.error("Error updating subnet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Delete SubNet ---
router.delete("/subnets/:id", auth, async (req, res) => {
  if (!req.user || typeof req.user !== "object" || !("id" in req.user)) {
    return res.status(401).send("Invalid token payload");
  }
  
  const userId = (req.user as any).id;
  const { id } = req.params;

  try {
    // Check if subnet exists and belongs to user
    const subnet = await prisma.subNet.findUnique({
      where: { id },
      include: {
        children: {
          select: { id: true }
        },
        defaultFor: {
          select: { id: true }
        }
      }
    });

    if (!subnet) {
      return res.status(404).json({ error: "Subnet not found" });
    }

    if (subnet.ownerId !== userId) {
      return res.status(403).json({ error: "You do not have permission to delete this subnet" });
    }

    // Check if this subnet is set as default for the user
    if (subnet.defaultFor.length > 0) {
      return res.status(400).json({ 
        error: "Cannot delete subnet that is set as default. Please change your default subnet first." 
      });
    }

    // Handle children - either prevent deletion or move them to root level
    if (subnet.children.length > 0) {
      // Option 1: Prevent deletion if has children
      return res.status(400).json({ 
        error: "Cannot delete subnet that has child subnets. Please delete or move children first." 
      });

      // Option 2 (alternative): Move children to root level
      // await prisma.subNet.updateMany({
      //   where: { parentId: id },
      //   data: { parentId: null }
      // });
    }

    // Delete the subnet (this will cascade delete members and update posts to null)
    await prisma.subNet.delete({
      where: { id }
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting subnet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
