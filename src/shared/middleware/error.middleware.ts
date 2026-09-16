import { Request, Response, NextFunction } from "express";
import { AppError } from "@/shared/types/errors";
import { DBErrorCode } from "../constants/postgresErrorCode";

import {
  QueryFailedError,
  EntityNotFoundError,
  CannotCreateEntityIdMapError,
  OptimisticLockVersionMismatchError,
  NoNeedToReleaseEntityManagerError,
  QueryRunnerAlreadyReleasedError,
  QueryRunnerProviderAlreadyReleasedError,
  TransactionAlreadyStartedError,
  TransactionNotStartedError,
  DataTypeNotSupportedError,
  EntityMetadataNotFoundError,
  ConnectionNotFoundError,
  AlreadyHasActiveConnectionError,
  CannotConnectAlreadyConnectedError,
  CannotGetEntityManagerNotConnectedError,
  MissingDriverError,
  MissingPrimaryColumnError,
  MustBeEntityError,
  CustomRepositoryNotFoundError,
  RepositoryNotTreeError,
  TreeRepositoryNotSupportedError,
  UsingJoinColumnIsNotAllowedError,
  UsingJoinTableIsNotAllowedError,
  UsingJoinColumnOnlyOnOneSideAllowedError,
  UsingJoinTableOnlyOnOneSideAllowedError,
  PersistedEntityNotFoundError,
  CannotAttachTreeChildrenEntityError,
  InitializedRelationError,
  ColumnTypeUndefinedError,
} from "typeorm";
import { config } from "@/config/env";

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  let statusCode = 500;
  let message = "Đã xảy ra lỗi không xác định. Vui lòng thử lại sau.";
  let errors: any = null;

  // Handle operational errors
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    errors = error.errors || null;
  }

  // Handle validation errors
  if (error.name === "ValidationError") {
    statusCode = 400;
    message =
      "Đã xảy ra lỗi định dạng dữ liệu. Vui lòng kiểm tra lại dữ liệu đầu vào.";
    errors = error.message;
  }

  // Handle all TypeORM errors
  if (error instanceof QueryFailedError) {
    statusCode = 400;
    message = "Truy vấn cơ sở dữ liệu thất bại";
    errors = [DBErrorCode[error.driverError.code as keyof typeof DBErrorCode]];
  } else if (error instanceof EntityNotFoundError) {
    statusCode = 404;
    message = "Không tìm thấy thực thể";
    errors = [DBErrorCode[error.criteria.code as keyof typeof DBErrorCode]];
  } else if (error instanceof CannotCreateEntityIdMapError) {
    statusCode = 400;
    message = "Không thể tạo ID map thực thể";
    errors = [DBErrorCode[error.name as keyof typeof DBErrorCode]];
  } else if (error instanceof OptimisticLockVersionMismatchError) {
    statusCode = 409;
    message = "Optimistic Lock Version Mismatch";
    errors = {
      type: "OptimisticLockVersionMismatchError",
      message: error.message,
    };
  } else if (error instanceof NoNeedToReleaseEntityManagerError) {
    statusCode = 400;
    message = "No Need To Release Entity Manager";
    errors = {
      type: "NoNeedToReleaseEntityManagerError",
      message: error.message,
    };
  } else if (error instanceof QueryRunnerAlreadyReleasedError) {
    statusCode = 400;
    message = "Query Runner Already Released";
    errors = {
      type: "QueryRunnerAlreadyReleasedError",
      message: error.message,
    };
  } else if (error instanceof QueryRunnerProviderAlreadyReleasedError) {
    statusCode = 400;
    message = "Query Runner Provider Already Released";
    errors = {
      type: "QueryRunnerProviderAlreadyReleasedError",
      message: error.message,
    };
  } else if (error instanceof TransactionAlreadyStartedError) {
    statusCode = 400;
    message = "Transaction Already Started";
    errors = {
      type: "TransactionAlreadyStartedError",
      message: error.message,
    };
  } else if (error instanceof TransactionNotStartedError) {
    statusCode = 400;
    message = "Transaction Not Started";
    errors = {
      type: "TransactionNotStartedError",
      message: error.message,
    };
  } else if (error instanceof DataTypeNotSupportedError) {
    statusCode = 400;
    message = "Data Type Not Supported";
    errors = {
      type: "DataTypeNotSupportedError",
      message: error.message,
    };
  } else if (error instanceof EntityMetadataNotFoundError) {
    statusCode = 400;
    message = "Entity Metadata Not Found";
    errors = {
      type: "EntityMetadataNotFoundError",
      message: error.message,
    };
  } else if (error instanceof ConnectionNotFoundError) {
    statusCode = 500;
    message = "Database Connection Not Found";
    errors = {
      type: "ConnectionNotFoundError",
      message: error.message,
    };
  } else if (error instanceof AlreadyHasActiveConnectionError) {
    statusCode = 400;
    message = "Already Has Active Connection";
    errors = {
      type: "AlreadyHasActiveConnectionError",
      message: error.message,
    };
  } else if (error instanceof CannotConnectAlreadyConnectedError) {
    statusCode = 400;
    message = "Cannot Connect Already Connected";
    errors = {
      type: "CannotConnectAlreadyConnectedError",
      message: error.message,
    };
  } else if (error instanceof CannotGetEntityManagerNotConnectedError) {
    statusCode = 500;
    message = "Cannot Get Entity Manager Not Connected";
    errors = {
      type: "CannotGetEntityManagerNotConnectedError",
      message: error.message,
    };
  } else if (error instanceof MissingDriverError) {
    statusCode = 500;
    message = "Missing Database Driver";
    errors = {
      type: "MissingDriverError",
      message: error.message,
    };
  } else if (error instanceof MissingPrimaryColumnError) {
    statusCode = 400;
    message = "Missing Primary Column";
    errors = {
      type: "MissingPrimaryColumnError",
      message: error.message,
    };
  } else if (error instanceof MustBeEntityError) {
    statusCode = 400;
    message = "Must Be Entity";
    errors = {
      type: "MustBeEntityError",
      message: error.message,
    };
  } else if (error instanceof CustomRepositoryNotFoundError) {
    statusCode = 404;
    message = "Custom Repository Not Found";
    errors = {
      type: "CustomRepositoryNotFoundError",
      message: error.message,
    };
  } else if (error instanceof RepositoryNotTreeError) {
    statusCode = 400;
    message = "Repository Not Tree";
    errors = {
      type: "RepositoryNotTreeError",
      message: error.message,
    };
  } else if (error instanceof TreeRepositoryNotSupportedError) {
    statusCode = 400;
    message = "Tree Repository Not Supported";
    errors = {
      type: "TreeRepositoryNotSupportedError",
      message: error.message,
    };
  } else if (error instanceof UsingJoinColumnIsNotAllowedError) {
    statusCode = 400;
    message = "Using Join Column Is Not Allowed";
    errors = {
      type: "UsingJoinColumnIsNotAllowedError",
      message: error.message,
    };
  } else if (error instanceof UsingJoinTableIsNotAllowedError) {
    statusCode = 400;
    message = "Using Join Table Is Not Allowed";
    errors = {
      type: "UsingJoinTableIsNotAllowedError",
      message: error.message,
    };
  } else if (error instanceof UsingJoinColumnOnlyOnOneSideAllowedError) {
    statusCode = 400;
    message = "Using Join Column Only On One Side Allowed";
    errors = {
      type: "UsingJoinColumnOnlyOnOneSideAllowedError",
      message: error.message,
    };
  } else if (error instanceof UsingJoinTableOnlyOnOneSideAllowedError) {
    statusCode = 400;
    message = "Using Join Table Only On One Side Allowed";
    errors = {
      type: "UsingJoinTableOnlyOnOneSideAllowedError",
      message: error.message,
    };
  } else if (error instanceof PersistedEntityNotFoundError) {
    statusCode = 404;
    message = "Persisted Entity Not Found";
    errors = {
      type: "PersistedEntityNotFoundError",
      message: error.message,
    };
  } else if (error instanceof CannotAttachTreeChildrenEntityError) {
    statusCode = 400;
    message = "Cannot Attach Tree Children Entity";
    errors = {
      type: "CannotAttachTreeChildrenEntityError",
      message: error.message,
    };
  } else if (error instanceof InitializedRelationError) {
    statusCode = 400;
    message = "Initialized Relation Error";
    errors = {
      type: "InitializedRelationError",
      message: error.message,
    };
  } else if (error instanceof ColumnTypeUndefinedError) {
    statusCode = 400;
    message = "Column Type Undefined";
    errors = {
      type: "ColumnTypeUndefinedError",
      message: error.message,
    };
  }

  // Handle JWT errors
  if (error.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  }

  if (error.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }

  // Log error in development
  if (config.NODE_ENV === "development") {
    console.error("Error:", error);
  }

  res.status(statusCode).json({
    statusCode,
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString(),
    ...(config.NODE_ENV === "development" && { stack: error.stack }),
  });
};
