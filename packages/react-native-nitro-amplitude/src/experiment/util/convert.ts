import { EvaluationVariant } from "@amplitude/experiment-core";

import { ExperimentUser } from "../types/user";
import { Variant } from "../types/variant";

export const convertUserToContext = (
  user: ExperimentUser | undefined,
): Record<string, unknown> => {
  if (!user) {
    return {};
  }
  const contextUser: ExperimentUser = { ...user };
  const context: Record<string, unknown> = { user: contextUser };
  const groups: Record<string, Record<string, unknown>> = {};
  if (!user.groups) {
    return context;
  }
  for (const groupType of Object.keys(user.groups)) {
    const groupNames: string[] = user.groups[groupType] ?? [];
    if (groupNames.length > 0 && groupNames[0]) {
      const groupName = groupNames[0];
      const groupNameMap: Record<string, unknown> = {
        group_name: groupName,
      };
      // Check for group properties
      const groupProperties = user.group_properties?.[groupType]?.[groupName];
      if (groupProperties && Object.keys(groupProperties).length > 0) {
        groupNameMap["group_properties"] = groupProperties;
      }
      groups[groupType] = groupNameMap;
    }
  }
  if (Object.keys(groups).length > 0) {
    context["groups"] = groups;
  }
  delete contextUser.groups;
  delete contextUser.group_properties;
  return context;
};

export const convertVariant = (
  value: string | Variant | undefined,
): Variant => {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    return {
      key: value,
      value: value,
    };
  } else {
    return value;
  }
};

export const convertEvaluationVariantToVariant = (
  evaluationVariant: EvaluationVariant,
): Variant => {
  if (!evaluationVariant) {
    return {};
  }
  let experimentKey: string | undefined;
  if (evaluationVariant.metadata) {
    const metadataExperimentKey = evaluationVariant.metadata["experimentKey"];
    if (typeof metadataExperimentKey === "string") {
      experimentKey = metadataExperimentKey;
    }
  }
  const variant: Variant = {};
  if (evaluationVariant.key) variant.key = evaluationVariant.key;
  if (evaluationVariant.value)
    variant.value = evaluationVariant.value as string;
  if (evaluationVariant.payload) variant.payload = evaluationVariant.payload;
  if (experimentKey) variant.expKey = experimentKey;
  if (evaluationVariant.metadata) variant.metadata = evaluationVariant.metadata;
  return variant;
};
